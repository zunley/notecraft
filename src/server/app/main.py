"""组装根（composition root）：创建 FastAPI 实例、装配依赖、注册路由。

依赖方向（架构铁律）：
    api/ → core/ → ports ← adapters/
- api/   只做 HTTP 解析、校验、响应，调用 core 用例，不含业务规则
- core/  用例编排，纯 Python，禁止 import fastapi，只依赖 ports 中的 Protocol
- ports  接口契约（依赖倒置的接缝）
- adapters/ 实现 ports，由本文件构造并注入 core

★ 灵活性来源：换实现（用户表账号、LLM 直连网关）只动 adapters/ 与本文件，
  core/ 与 api/ 零改动——对应 ARCHITECTURE.md §4 的全部演进切换点。

已装配（阶段 2/4）：FileUserStore → AuthCore；HttpLlmGateway + MemRelayQuota → RelayCore；
api 路由 + 领域错误统一翻译 + 按 IP 的注册/登录限速中间件 + token 签名密钥。
阶段 5 追加：FileNoteStore 完整实现 → SyncCore → sync 路由。
★ 装配形态（不引 DI 容器）：实例挂 app.state，api 层用 FastAPI Depends 取用；
  测试用 dependency_overrides 或 create_app(settings) 注入，不 monkeypatch。
★ 日志纪律：不记录请求体/响应体（零知识，DESIGN.md §6.5）。
"""

from __future__ import annotations

import math
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .adapters.file_store import FileNoteStore
from .adapters.llm_gateway import HttpLlmGateway
from .adapters.relay_quota import MemRelayQuota
from .adapters.user_store import FileUserStore
from .api import api_router
from .config import Settings, get_settings
from .core.auth import AuthCore
from .core.relay import RelayCore
from .core.sync import SyncCore
from .errors import DomainError, RateLimitError, RelayQuotaExceededError

# 注册/登录限速（按 IP）的窗口
_RATE_WINDOW_S = 60.0


def _resolve_token_secret(settings: Settings) -> bytes:
    """token 签名密钥：env 优先，否则在数据目录生成并持久化（丢失 = 全部 token 失效）。"""
    if settings.token_secret:
        return settings.token_secret.encode("utf-8")
    path = settings.data_dir / "token_secret"
    try:
        existing = path.read_bytes()
        if existing:
            return existing
    except FileNotFoundError:
        pass
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_bytes(32)
    path.write_bytes(secret)
    path.chmod(0o600)
    return secret


def _install_cors(app: FastAPI, settings: Settings) -> None:
    """CORS 白名单（仅 Web 客户端直连跨源时配置；同源代理部署留空即不下发任何 CORS 头）。

    不用 cookie（Bearer token），故 allow_credentials=False——无 CSRF 面。
    """
    origins = settings.allowed_origins
    if not origins:
        return
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(origins),
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
        max_age=600,
    )


def _install_error_handlers(app: FastAPI) -> None:
    """领域错误 → HTTP 的唯一翻译点（core 抛、这里译，API.md §2）。"""

    @app.exception_handler(DomainError)
    async def _domain_error(request: Request, exc: DomainError) -> JSONResponse:
        headers: dict[str, str] = {}
        if isinstance(exc, RelayQuotaExceededError):
            headers["Retry-After"] = str(max(1, int(exc.reset_at - time.time())))
        elif isinstance(exc, RateLimitError) and exc.retry_after is not None:
            headers["Retry-After"] = str(exc.retry_after)
        body = {
            "error": {
                "code": exc.code,
                "message": str(exc) or exc.code,
                "details": exc.details(),
            }
        }
        return JSONResponse(body, status_code=exc.status, headers=headers)


def _install_auth_rate_limit(app: FastAPI, settings: Settings) -> None:
    """按 IP 的注册/登录限速（横切能力统一挂组装根；按 username 的在 core.auth）。"""

    buckets: dict[str, list[float]] = {}

    @app.middleware("http")
    async def _auth_ip_rate(request: Request, call_next):  # noqa: ANN202
        if request.method == "POST" and request.url.path in (
            "/api/auth/register",
            "/api/auth/login",
        ):
            now = time.monotonic()
            ip = request.client.host if request.client else "-"
            bucket = buckets.setdefault(ip, [])
            cutoff = now - _RATE_WINDOW_S
            bucket[:] = [t for t in bucket if t > cutoff]
            if len(bucket) >= settings.auth_rate:
                retry_after = max(1, math.ceil(_RATE_WINDOW_S - (now - bucket[0])))
                return JSONResponse(
                    {"error": {"code": "rate_limited", "message": "rate limited"}},
                    status_code=429,
                    headers={"Retry-After": str(retry_after)},
                )
            bucket.append(now)
            if len(buckets) > 4096:  # 简单防内存膨胀
                for key in [k for k, v in buckets.items() if not v]:
                    buckets.pop(key, None)
        return await call_next(request)


def _mount_web(app: FastAPI) -> None:
    """可选静态托管 Web 版（vite build 产物；不存在则仅 API）。"""
    dist = Path(__file__).resolve().parents[2] / "client" / "web" / "dist"
    if (dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="web")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(title="notecraft", version="0.1.0")
    app.state.settings = settings

    # ── 构造 adapters（换实现只改这里）──────────────────────────
    users = FileUserStore(settings.users_dir)
    notes = FileNoteStore(settings.notes_root, settings.file_max, settings.storage_quota)
    secret = _resolve_token_secret(settings)
    gateway = HttpLlmGateway(
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
        model=settings.openai_model,
    )
    quota = MemRelayQuota(settings.relay_daily_quota)

    # ── 注入 core ─────────────────────────────────────────────
    app.state.users = users
    app.state.notes = notes
    app.state.auth = AuthCore(users=users, notes=notes, settings=settings, secret=secret)
    app.state.relay = RelayCore(gateway=gateway, quota=quota, settings=settings)
    app.state.sync = SyncCore(store=notes, settings=settings)

    # ── 横切 + 路由 ────────────────────────────────────────────
    _install_error_handlers(app)
    _install_cors(app, settings)
    _install_auth_rate_limit(app, settings)
    app.include_router(api_router)

    _mount_web(app)  # 静态托管最后挂（兜底路由）
    return app


# ★ 装配入口是 create_app 工厂（无导入期副作用，数据目录/密钥只在真正启动时触碰）：
#     uvicorn app.main:create_app --factory
#   Dockerfile CMD 与 Makefile dev-api 均已按此调用。
