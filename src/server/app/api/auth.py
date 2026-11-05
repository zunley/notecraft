"""账户与认证路由（API.md §3）——HTTP 薄壳：解析 → 调 core → 响应。

不含量规则：策略、限速、凭证校验全在 core/auth。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from ..core.auth import AuthCore
from ..types import User
from .deps import require_user
from .schemas import (
    DeleteAccountRequest,
    KeyChangeRequest,
    LoginRequest,
    LoginResponse,
    PolicyResponse,
    RegisterRequest,
    TokenResponse,
)

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


def _core(request: Request) -> AuthCore:
    return request.app.state.auth


@auth_router.get("/policy", response_model=PolicyResponse)
def policy(request: Request) -> PolicyResponse:
    """免鉴权：客户端据此决定显示「登录」还是「登录 + 创建账号」。"""
    return PolicyResponse(**_core(request).policy())


@auth_router.post("/register", status_code=201, response_model=TokenResponse)
def register(body: RegisterRequest, request: Request) -> TokenResponse:
    """免鉴权（限速）：注册即登录——客户端此刻已持有 MK（本地刚生成）。"""
    token = _core(request).register(body.username, body.password, body.protected_key, body.invite)
    return TokenResponse(token=token.value, expires_at=int(token.expires_at))


@auth_router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request) -> LoginResponse:
    """免鉴权（限速）：校验 hash(L) → token + protected_key（登录即解锁）。"""
    token, protected_key = _core(request).login(body.username, body.password)
    return LoginResponse(
        token=token.value,
        expires_at=int(token.expires_at),
        protected_key=protected_key,
    )


@auth_router.post("/refresh", response_model=TokenResponse)
def refresh(request: Request, user: User = Depends(require_user)) -> TokenResponse:
    """滚动续期：sub 不变，不需要口令。"""
    token = _core(request).refresh(user)
    return TokenResponse(token=token.value, expires_at=int(token.expires_at))


@auth_router.put("/key", status_code=204)
def put_key(
    body: KeyChangeRequest,
    request: Request,
    user: User = Depends(require_user),
) -> Response:
    """换口令：必须携带旧 L；MK 不变 → 笔记密文一个字节都不动。"""
    _core(request).put_key(user, body.password, body.new_password, body.new_protected_key)
    return Response(status_code=204)


@auth_router.delete("/account", status_code=204)
def delete_account(
    body: DeleteAccountRequest,
    request: Request,
    user: User = Depends(require_user),
) -> Response:
    """注销：删用户记录 + 全部密文，不可恢复；全部旧 token 即时失效。"""
    _core(request).delete_account(user, body.password)
    return Response(status_code=204)
