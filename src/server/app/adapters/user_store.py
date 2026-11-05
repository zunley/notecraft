"""UserStore 实现：/data 卷上的用户表（零知识，API.md §8）。

每用户一个 JSON 文件 /data/users/<uid>.json：
{uid, username, login_verifier(=hash(L)), protected_key, created_at}

- uid 注册时生成（随机 16 字节 hex），永不改变——token sub 与 /notes/<uid>/ 都用它；
- username 小写唯一索引（/data/users/by-username/<username> → uid），仅作登录句柄，
  不进任何路径；索引用 O_EXCL 独占创建保证并发下的唯一性（防抢注的第一道锁）；
- 服务端从未见过口令/KEK/MK——拖库只能拿到 hash(L)（sha256，L 本身已过 Argon2id）
  与打不开的 protected_key；
- 写入一律 tmp + os.replace 原子替换。

远期替换：SQLite/Postgres（用户数 ~10³），只换本文件与 main.py 注入。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from ..errors import UnauthorizedError, UsernameTakenError
from ..types import USERNAME_RE, User


def _b64url_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _verifier(password: str) -> str:
    """hash(L)：L 是客户端 Argon2id 派生的高熵凭证，sha256 即可（服务端无口令可拖）。"""
    return hashlib.sha256(_b64url_decode(password)).hexdigest()


class FileUserStore:
    def __init__(self, users_dir: Path | str):
        # 注入的已是完整目录（settings.users_dir = <data_dir>/users）
        self.dir = Path(users_dir)
        self.by_username = self.dir / "by-username"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.by_username.mkdir(parents=True, exist_ok=True)

    # ── 路径 ──────────────────────────────────────────────────

    def _record_path(self, uid: str) -> Path:
        return self.dir / f"{uid}.json"

    def _index_path(self, username: str) -> Path | None:
        # 登录侧的 username 未经注册校验——形状不合法直接拒绝，杜绝路径穿越
        if not USERNAME_RE.fullmatch(username):
            return None
        return self.by_username / username

    @staticmethod
    def _atomic_write(path: Path, text: str) -> None:
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)

    def _read_record(self, uid: str) -> dict | None:
        try:
            return json.loads(self._record_path(uid).read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None

    # ── UserStore ─────────────────────────────────────────────

    def create(self, username: str, password: str, protected_key: str) -> User:
        idx = self._index_path(username)
        if idx is None:
            raise UsernameTakenError(f"invalid username: {username!r}")  # 不可达（core 已校验）
        try:
            fd = os.open(idx, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError as exc:
            raise UsernameTakenError(f"username taken: {username}") from exc

        uid = secrets.token_hex(16)
        created_at = time.time()
        record = {
            "uid": uid,
            "username": username,
            "login_verifier": _verifier(password),
            "protected_key": protected_key,
            "created_at": created_at,
        }
        try:
            self._atomic_write(self._record_path(uid), json.dumps(record, ensure_ascii=False))
            os.write(fd, uid.encode("ascii"))
        except BaseException:
            self._record_path(uid).unlink(missing_ok=True)
            idx.unlink(missing_ok=True)
            raise
        finally:
            os.close(fd)
        return User(uid=uid, username=username, created_at=created_at)

    def verify(self, username: str, password: str) -> tuple[str, str] | None:
        idx = self._index_path(username)
        if idx is None:
            return None
        try:
            uid = idx.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        record = self._read_record(uid)
        if record is None:
            return None
        if not hmac.compare_digest(record.get("login_verifier", ""), _verifier(password)):
            return None
        return uid, record.get("protected_key", "")

    def get(self, uid: str) -> User | None:
        record = self._read_record(uid)
        if record is None:
            return None
        return User(uid=record["uid"], username=record["username"], created_at=record["created_at"])

    def put_key(self, uid: str, password: str, protected_key: str) -> None:
        record = self._read_record(uid)
        if record is None:
            raise UnauthorizedError("user no longer exists")  # 注销后旧 token 即时失效
        record["login_verifier"] = _verifier(password)
        record["protected_key"] = protected_key
        self._atomic_write(self._record_path(uid), json.dumps(record, ensure_ascii=False))

    def delete(self, uid: str) -> None:
        record = self._read_record(uid)
        if record is None:
            return  # 幂等
        idx = self._index_path(record.get("username", ""))
        if idx is not None:
            idx.unlink(missing_ok=True)
        self._record_path(uid).unlink(missing_ok=True)
