"""健康检查（免鉴权）。"""

from __future__ import annotations

from fastapi import APIRouter

health_router = APIRouter(tags=["health"])


@health_router.get("/health")
def health() -> dict:
    return {"status": "ok"}
