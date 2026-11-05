"""HTTP 传输层（薄壳）：解析请求 → 调 core 用例 → 组装响应。

规则：不含业务规则、不直接触碰 adapters，只依赖 core 与 deps。

路由汇总：main.py 只 include 本文件导出的 api_router。
"""

from __future__ import annotations

from fastapi import APIRouter

from .auth import auth_router
from .health import health_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(health_router)
# 阶段 4 挂 relay_router（./relay.py，prefix="/api/ai/v1"——/v1 是 OpenAI 兼容约定）
# 阶段 5 挂 sync_router（./sync.py，prefix="/api/sync")
