"""LLM 透传（纯转发）——★ 服务端不含任何 Agent 逻辑，且零留存（DESIGN.md §6.5）。

AI Agent 100% 运行在客户端：工具循环、文件工具、prompt 组装、write-gate、
对话上下文管理全部在前端；服务端 /api/ai/v1/* 自始至终只是 OpenAI 兼容的
透明转发。本模块只做三件事：

- 配额：RelayQuota.take(uid)，耗尽 → RelayQuotaExceededError（429 + reset_at）
- 就绪：网关未配置 → GatewayUnavailableError（503）
- 转发：payload 经 ports.LlmGateway 透传（key 注入收敛在适配器内部）
- 零留存：转发即消失——不归档、不记录请求体、不持会话状态
  （会话历史由客户端 ai/sessionStore 存 IndexedDB，服务端无从获取）

不组装 prompt、不执行工具、不持会话状态——本文件永远不应出现此类代码。
"""

from __future__ import annotations

import time
from typing import Callable

from ..config import Settings
from ..errors import GatewayUnavailableError, InvalidRequestError, RelayQuotaExceededError
from ..ports import LlmGateway, RelayQuota, Stream


class RelayCore:
    def __init__(
        self,
        gateway: LlmGateway,
        quota: RelayQuota,
        settings: Settings,
        clock: Callable[[], float] = time.time,
    ):
        self.gateway = gateway
        self.quota = quota
        self.settings = settings
        self._clock = clock

    def prepare(self, subject: str, payload: object) -> dict:
        """转发前的准入检查（顺序：形状 → 就绪 → 配额，先于消耗额度）。"""
        if not isinstance(payload, dict):
            raise InvalidRequestError("请求体必须是 JSON 对象")
        if not self.gateway.ready:
            raise GatewayUnavailableError()
        if not self.quota.take(subject):
            raise RelayQuotaExceededError(reset_at=self.quota.reset_at(subject))
        return payload

    async def stream(self, subject: str, payload: object) -> Stream:
        body = self.prepare(subject, payload)
        return await self.gateway.stream(body)
