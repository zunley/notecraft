"""core/auth 单测：纯 Python，fake ports（Protocol 原生可替）——不碰文件系统与 HTTP。"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.core.auth import AuthCore
from app.errors import (
    AuthError,
    InvalidRequestError,
    RateLimitError,
    RegistrationClosedError,
    UnauthorizedError,
    UsernameTakenError,
)
from app.types import User


class FakeClock:
    def __init__(self, start: float = 1_765_000_000.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class FakeUsers:
    """内存版 UserStore：verifier 直接存 password（哈希等价性由实现层负责）。"""

    def __init__(self) -> None:
        self.records: dict[str, dict] = {}
        self.by_name: dict[str, str] = {}

    def create(self, username: str, password: str, protected_key: str) -> User:
        if username in self.by_name:
            raise UsernameTakenError(f"username taken: {username}")
        uid = f"{len(self.records) + 1:032x}"
        self.records[uid] = {
            "uid": uid,
            "username": username,
            "login_verifier": password,
            "protected_key": protected_key,
            "created_at": 1.0,
        }
        self.by_name[username] = uid
        return User(uid=uid, username=username, created_at=1.0)

    def verify(self, username: str, password: str) -> tuple[str, str] | None:
        uid = self.by_name.get(username)
        if uid is None:
            return None
        rec = self.records[uid]
        if rec["login_verifier"] != password:
            return None
        return uid, rec["protected_key"]

    def get(self, uid: str) -> User | None:
        rec = self.records.get(uid)
        if rec is None:
            return None
        return User(uid=rec["uid"], username=rec["username"], created_at=rec["created_at"])

    def put_key(self, uid: str, password: str, protected_key: str) -> None:
        self.records[uid]["login_verifier"] = password
        self.records[uid]["protected_key"] = protected_key

    def delete(self, uid: str) -> None:
        rec = self.records.pop(uid, None)
        if rec:
            self.by_name.pop(rec["username"], None)


class FakeNotes:
    def __init__(self) -> None:
        self.purged: list[str] = []

    def purge(self, subject: str) -> None:
        self.purged.append(subject)


def make_core(**overrides) -> tuple[AuthCore, FakeUsers, FakeNotes, FakeClock]:
    settings = Settings(
        registration=overrides.get("registration", "open"),
        invite_code=overrides.get("invite_code", ""),
        auth_rate=overrides.get("auth_rate", 10),
        token_ttl=overrides.get("token_ttl", 72 * 3600),
        token_secret="test",
    )
    users = FakeUsers()
    notes = FakeNotes()
    clock = FakeClock()
    core = AuthCore(users=users, notes=notes, settings=settings, secret=b"unit-test", clock=clock)
    return core, users, notes, clock


def register(core: AuthCore, username: str = "alice", password: str = "cGFzcw", pk: str = "cGs"):
    return core.register(username, password, pk, invite=None)


# ── 注册 ──────────────────────────────────────────────────────


def test_register_returns_token_bound_to_uid() -> None:
    core, users, _, _ = make_core()
    token = register(core)
    uid = next(iter(users.records))
    assert token.subject == uid
    assert core.authenticate(token.value).uid == uid


def test_register_rejects_bad_username() -> None:
    core, _, _, _ = make_core()
    for bad in ("Ab", "x", "-abc", "a" * 33, "用户名", ""):
        with pytest.raises(InvalidRequestError):
            register(core, username=bad)


def test_register_rejects_non_b64url_envelope() -> None:
    core, _, _, _ = make_core()
    with pytest.raises(InvalidRequestError):
        core.register("alice", "not base64!!", "cGs", None)
    with pytest.raises(InvalidRequestError):
        core.register("alice", "cGFzcw", "pk with space", None)


def test_register_duplicate_username_conflict() -> None:
    core, _, _, _ = make_core()
    register(core)
    with pytest.raises(UsernameTakenError):
        register(core)


def test_register_closed_policy() -> None:
    core, _, _, _ = make_core(registration="closed")
    with pytest.raises(RegistrationClosedError):
        register(core)


def test_register_invite_policy() -> None:
    core, _, _, _ = make_core(registration="invite", invite_code="sesame")
    with pytest.raises(RegistrationClosedError):
        core.register("alice", "cGFzcw", "cGs", invite=None)
    with pytest.raises(RegistrationClosedError):
        core.register("alice", "cGFzcw", "cGs", invite="wrong")
    token = core.register("alice", "cGFzcw", "cGs", invite="sesame")
    assert token.subject


# ── 登录 ──────────────────────────────────────────────────────


def test_login_returns_token_and_protected_key() -> None:
    core, _, _, _ = make_core()
    register(core, password="L1", pk="envelope")
    token, pk = core.login("alice", "L1")
    assert pk == "envelope"
    assert core.authenticate(token.value).username == "alice"


def test_login_wrong_password_is_auth_error() -> None:
    core, _, _, _ = make_core()
    register(core, password="L1")
    with pytest.raises(AuthError):
        core.login("alice", "wrong")
    with pytest.raises(AuthError):  # 防枚举：不存在的用户同样 401 invalid_credentials
        core.login("nobody", "wrong")


# ── token 生命周期 ────────────────────────────────────────────


def test_refresh_keeps_sub() -> None:
    core, _, _, clock = make_core()
    token = register(core)
    user = core.authenticate(token.value)
    clock.advance(10)
    fresh = core.refresh(user)
    assert fresh.subject == token.subject
    assert fresh.expires_at > token.expires_at


def test_tampered_token_rejected() -> None:
    core, _, _, _ = make_core()
    token = register(core)
    body, sig = token.value.split(".", 1)
    with pytest.raises(UnauthorizedError):
        core.authenticate(f"{body}.{sig[:-2]}aa")


def test_expired_token_rejected() -> None:
    core, _, _, clock = make_core(token_ttl=60)
    token = register(core)
    clock.advance(61)
    with pytest.raises(UnauthorizedError):
        core.authenticate(token.value)


def test_deleted_user_token_immediately_invalid() -> None:
    core, users, _, _ = make_core()
    token = register(core)
    users.delete(token.subject)
    with pytest.raises(UnauthorizedError):
        core.authenticate(token.value)


# ── 换口令 / 注销 ─────────────────────────────────────────────


def test_put_key_rotates_credential_without_touching_notes() -> None:
    core, users, _, _ = make_core()
    token = register(core, password="L1", pk="old-envelope")
    user = core.authenticate(token.value)
    core.put_key(user, old_password="L1", new_password="L2", new_protected_key="new-envelope")
    assert users.verify("alice", "L1") is None  # 旧凭证失效
    assert users.verify("alice", "L2") == (user.uid, "new-envelope")  # MK 信封已换
    assert core.login("alice", "L2")[1] == "new-envelope"


def test_put_key_requires_old_password() -> None:
    core, _, _, _ = make_core()
    token = register(core, password="L1")
    user = core.authenticate(token.value)
    with pytest.raises(AuthError):
        core.put_key(user, old_password="bad", new_password="L2", new_protected_key="env2")


def test_delete_account_requires_password_and_purges_notes() -> None:
    core, users, notes, _ = make_core()
    token = register(core, password="L1")
    user = core.authenticate(token.value)
    with pytest.raises(AuthError):
        core.delete_account(user, "wrong")
    assert notes.purged == []
    core.delete_account(user, "L1")
    assert notes.purged == [user.uid]
    assert users.get(user.uid) is None
    with pytest.raises(UnauthorizedError):  # 注销即时失效
        core.authenticate(token.value)


# ── 限速（按 username）────────────────────────────────────────


def test_login_throttle_per_username() -> None:
    core, users, _, clock = make_core(auth_rate=3)
    users.create("alice", "L1", "pk")  # 直接建号：注册限速不干扰被测窗口
    for _ in range(3):
        with pytest.raises(AuthError):
            core.login("alice", "wrong")
    with pytest.raises(RateLimitError) as exc:
        core.login("alice", "wrong")
    assert exc.value.retry_after is not None and 1 <= exc.value.retry_after <= 60
    clock.advance(61)
    with pytest.raises(AuthError):  # 窗口滑过，恢复尝试（仍是凭证错误）
        core.login("alice", "wrong")
