"""LLM 中继路由（API.md §5）——OpenAI 兼容透传，零留存。

- 校验 token（require_user）→ core.relay（配额/就绪）→ LlmGateway 流式回传；
- 上游 4xx/5xx 原样透传（状态码 + 原始响应体，OpenAI 形状）；
- ★ 访问日志只记 method/path/status/耗时/uid——不记请求体（零留存纪律）。
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse

from ..core.relay import RelayCore
from ..errors import InvalidRequestError
from ..ports import UpstreamError
from ..types import User
from .deps import require_user

logger = logging.getLogger("notecraft.relay")

relay_router = APIRouter(prefix="/api/ai/v1", tags=["relay"])


@relay_router.post("/chat/completions")
async def chat_completions(request: Request, user: User = Depends(require_user)) -> Response:
    try:
        payload = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise InvalidRequestError("请求体必须是 JSON") from exc

    core: RelayCore = request.app.state.relay
    try:
        stream = await core.stream(user.uid, payload)
    except UpstreamError as exc:
        # 上游错误原样透传（保持 OpenAI 错误形状，不包进本错误模型）
        logger.info("relay uid=%s upstream=%d", user.uid, exc.status)
        return Response(content=exc.body, status_code=exc.status, media_type="application/json")

    logger.info("relay uid=%s ok", user.uid)  # 零留存：不记 body
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
