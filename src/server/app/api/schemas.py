"""Pydantic 请求/响应模型——只做 HTTP 序列化壳。

★ 业务/契约类型见 app/types.py（跨层唯一来源）；本文件不定义领域形状，
  只负责 wire 格式。字段形状的权威规格是 docs/API.md §3。
★ 形状/业务校验（username 规则、base64url 信封）在 core/auth——
  schemas 只声明类型，避免规则出现第二个来源。
"""

from __future__ import annotations

from pydantic import BaseModel


# ── auth（API.md §3）──────────────────────────────────────────


class RegisterRequest(BaseModel):
    username: str
    password: str  # base64url(L)——客户端派生的登录凭证，非口令本身
    protected_key: str  # base64url(信封)：KEK 加密的 MK，服务端打不开
    invite: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class KeyChangeRequest(BaseModel):
    password: str  # 旧 L（防止 token 被盗者把账号改锁死）
    new_password: str
    new_protected_key: str


class DeleteAccountRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    token: str
    expires_at: int


class LoginResponse(BaseModel):
    token: str
    expires_at: int
    protected_key: str  # 供 KEK 解封 MK（登录即解锁，DESIGN.md §6.3）


class PolicyResponse(BaseModel):
    registration: str  # open | invite | closed


# ── sync（API.md §4，阶段 5 接入）─────────────────────────────
# ── relay（API.md §5，阶段 4 接入）────────────────────────────
