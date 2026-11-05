"""认证用例：注册、登录、续期、换口令、注销（零知识 + 多租户，DESIGN.md §6.3）。

- register：username 形状与策略（config 注册策略 / 邀请码）→ UserStore.create
  （username 冲突抛 UsernameTakenError）→ 签发 token（注册即登录）
  ★ 无管理员概念：运营者直接在服务器文件系统操作，不加任何管理接口
- login：UserStore.verify 校验凭证哈希 → 签发 token + 返回 protected_key；
  凭证错误一律 AuthError（不区分用户是否存在，防枚举）
- refresh：滚动续期（sub 不变），不需要口令
- put_key：校验旧口令 → 更新 hash(L) 与信封（MK 不变，笔记密文不动）
- delete_account：校验口令 → UserStore.delete + NoteStore.purge（API.md §3 注销）
- 按 username 的登录/注册/换口令限速在本层（读了 body 才有 username）；
  按 IP 的限速是 main.py 中间件
- token：HMAC-SHA256，payload {sub=uid, iat, exp}，TTL 可配（API.md §7）
- authenticate：验签 → 查用户仍存在（注销即 token 失效）——require_user 的后端
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import time
from typing import Callable

from ..config import Settings
from ..errors import (
    AuthError,
    InvalidRequestError,
    RateLimitError,
    RegistrationClosedError,
    UnauthorizedError,
)
from ..ports import NoteStore, UserStore
from ..types import B64URL_RE, USERNAME_RE, Token, User


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _check_envelope(name: str, value: str) -> None:
    if not value or not B64URL_RE.fullmatch(value):
        raise InvalidRequestError(f"{name} 必须是 base64url（无填充）")


class AuthCore:
    def __init__(
        self,
        users: UserStore,
        notes: NoteStore,
        settings: Settings,
        secret: bytes,
        clock: Callable[[], float] = time.time,
    ):
        self.users = users
        self.notes = notes
        self.settings = settings
        self._secret = secret
        self._clock = clock
        # 按 username 的滑动窗口（次/分）；按 IP 的窗口在 main.py 中间件
        self._attempts: dict[str, list[float]] = {}

    # ── 限速（按 username，本层唯一能拿到 username 的地方）────────

    def _throttle(self, key: str) -> None:
        now = self._clock()
        window = self._attempts.setdefault(key[:64], [])
        cutoff = now - 60.0
        window[:] = [t for t in window if t > cutoff]
        if len(window) >= self.settings.auth_rate:
            retry_after = max(1, math.ceil(60.0 - (now - window[0])))
            raise RateLimitError(retry_after=retry_after)
        window.append(now)

    # ── token ─────────────────────────────────────────────────

    def _issue(self, uid: str) -> Token:
        now = int(self._clock())
        payload = {"sub": uid, "iat": now, "exp": now + int(self.settings.token_ttl)}
        body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        sig = _b64url_encode(hmac.new(self._secret, body.encode("ascii"), hashlib.sha256).digest())
        return Token(value=f"{body}.{sig}", subject=uid, expires_at=float(payload["exp"]))

    def authenticate(self, raw_token: str) -> User:
        """验签 + 解 sub + 确认用户仍存在——require_user（多租户唯一切换点）的后端。"""
        if not raw_token or "." not in raw_token:
            raise UnauthorizedError("missing or malformed token")
        body, sig = raw_token.split(".", 1)
        expected = _b64url_encode(hmac.new(self._secret, body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, sig):
            raise UnauthorizedError("bad token signature")
        try:
            payload = json.loads(_b64url_decode(body))
        except (ValueError, json.JSONDecodeError) as exc:
            raise UnauthorizedError("bad token payload") from exc
        if int(payload.get("exp", 0)) < self._clock():
            raise UnauthorizedError("token expired")
        uid = payload.get("sub")
        user = self.users.get(uid) if isinstance(uid, str) else None
        if user is None:
            raise UnauthorizedError("user no longer exists")  # 注销 → 旧 token 即时失效
        return user

    # ── 用例 ──────────────────────────────────────────────────

    def policy(self) -> dict:
        return {"registration": self.settings.registration}

    def register(self, username: str, password: str, protected_key: str, invite: str | None) -> Token:
        if not USERNAME_RE.fullmatch(username or ""):
            raise InvalidRequestError("username 需为 3–32 位小写字母/数字/_/-，且以字母或数字开头")
        _check_envelope("password", password)
        _check_envelope("protected_key", protected_key)
        self._throttle(f"u:{username}")

        mode = self.settings.registration
        if mode == "closed":
            raise RegistrationClosedError("注册已关闭")
        if mode == "invite":
            expected = self.settings.invite_code
            if not invite or not hmac.compare_digest(invite, expected):
                raise RegistrationClosedError("邀请码无效")

        user = self.users.create(username, password, protected_key)  # 冲突 → UsernameTakenError(409)
        return self._issue(user.uid)

    def login(self, username: str, password: str) -> tuple[Token, str]:
        if not username or not password:
            raise AuthError("invalid credentials")  # 形状缺失也归 401，不泄露任何信息
        _check_envelope("password", password)
        self._throttle(f"u:{username}")
        result = self.users.verify(username, password)
        if result is None:
            raise AuthError("invalid credentials")
        uid, protected_key = result
        return self._issue(uid), protected_key

    def refresh(self, user: User) -> Token:
        return self._issue(user.uid)

    def put_key(self, user: User, old_password: str, new_password: str, new_protected_key: str) -> None:
        _check_envelope("password", old_password)
        _check_envelope("new_password", new_password)
        _check_envelope("new_protected_key", new_protected_key)
        self._throttle(f"u:{user.username}")
        if self.users.verify(user.username, old_password) is None:
            raise AuthError("invalid credentials")  # token 被盗者无旧口令 → 改不动信封
        self.users.put_key(user.uid, new_password, new_protected_key)

    def delete_account(self, user: User, password: str) -> None:
        _check_envelope("password", password)
        self._throttle(f"u:{user.username}")
        if self.users.verify(user.username, password) is None:
            raise AuthError("invalid credentials")
        self.users.delete(user.uid)
        self.notes.purge(user.uid)  # 删除 /notes/<uid>/ 全部密文，不可恢复
