"""LlmGateway 实现：httpx 流式转发到 OpenAI 兼容网关。

★ OPENAI_API_KEY 只存在于本实现内部，注入上游请求头，永不出现在
  core/api 响应或下发给客户端的任何数据中。
★ 零留存（DESIGN.md §6.5）：转发即消失——不归档、不记录请求体、不持会话状态。
★ 上游错误原样透传（API.md §5，保持 OpenAI 形状、不包进本项目错误模型）：
  上游 4xx/5xx 的状态码与响应体经 ports.UpstreamError 交回 api 层原样返回；
  连接失败等网络错误则生成 OpenAI 形状的 502。

直连网关（DirectTransport，DESIGN.md §6.7）启用后，本适配器随中继一并退役。
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from ..errors import GatewayUnavailableError
from ..ports import Stream, UpstreamError


class HttpLlmGateway:
    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 180.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    @property
    def ready(self) -> bool:
        return bool(self.base_url and self.api_key)

    async def stream(self, payload: dict) -> Stream:
        if not self.ready:
            raise GatewayUnavailableError()

        body = dict(payload)
        if self.model:
            # 模型选择归服务端（与 key 注入同理）：配置了 OPENAI_MODEL 即以它为准
            body["model"] = self.model
        body.setdefault("stream", True)

        client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(30.0, read=self.timeout),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "text/event-stream",
            },
        )
        request = client.build_request("POST", "/chat/completions", json=body)
        try:
            upstream = await client.send(request, stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            raise UpstreamError(
                502,
                json.dumps(
                    {"error": {"message": f"upstream unreachable: {exc.__class__.__name__}", "type": "server_error"}},
                ).encode("utf-8"),
            ) from exc

        if upstream.status_code >= 400:
            # 上游错误原样透传（状态码 + 原始响应体，OpenAI 形状）
            raw = await upstream.aread()
            await client.aclose()
            raise UpstreamError(upstream.status_code, raw)

        async def iterate() -> AsyncIterator[bytes]:
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        return iterate()
