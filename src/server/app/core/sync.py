"""同步用例：manifest 组装、文件推拉、删除、乐观锁判定（API.md §4）。

服务端全程只见密文（DESIGN.md §6.4）——不理解、也不尝试理解任何明文语义：
- hash = 传输字节（密文）的 sha256——密文哈希天然满足乐观锁一致性；
- rev 为每用户专属计数器，只有该用户自己的推送会推进它（自管于 NoteStore）；
- 配额与单文件上限由 NoteStore 自管（bytes 统计就近），错误直接上抛由 api 翻译。

协议版本：manifest 响应带 protocol 字段（ARCHITECTURE.md §10 协议演进约定）。
"""

from __future__ import annotations

from ..config import Settings
from ..errors import InvalidRequestError, NotFoundError
from ..ports import NoteStore
from ..types import B64URL_RE

PROTOCOL = 1  # 同步协议版本（manifest.protocol；客户端 config.syncProtocol 对应）


class SyncCore:
    def __init__(self, store: NoteStore, settings: Settings):
        self.store = store
        self.settings = settings

    # ── 校验（wire 形状的唯一入口）─────────────────────────────

    @staticmethod
    def _check_b64url(name: str, value: str) -> str:
        if not isinstance(value, str) or not value or not B64URL_RE.fullmatch(value):
            raise InvalidRequestError(f"{name} 必须是 base64url（无填充）")
        return value

    @staticmethod
    def _check_base_hash(value: str) -> str:
        if not isinstance(value, str):
            raise InvalidRequestError("base_hash 必须是字符串")
        if value and not B64URL_RE.fullmatch(value):
            raise InvalidRequestError("base_hash 格式非法")
        return value

    # ── 用例 ──────────────────────────────────────────────────

    def manifest(self, subject: str) -> dict:
        m = self.store.manifest(subject)
        return {
            "protocol": PROTOCOL,
            "rev": m.rev,
            "files": [
                {"path": e.path, "hash": e.hash, "mtime": e.mtime, "size": e.size}
                for e in m.files
            ],
        }

    def get(self, subject: str, path: str) -> dict:
        self._check_b64url("path", path)
        stored = self.store.read(subject, path)
        if stored is None:
            raise NotFoundError("file not found")
        return {"content": stored.content, "hash": stored.hash, "mtime": stored.mtime}

    def put(self, subject: str, path: str, content: str, base_hash: str) -> dict:
        self._check_b64url("path", path)
        self._check_b64url("content", content)
        self._check_base_hash(base_hash)
        self.store.write(subject, path, content, base_hash)
        # rev 由 NoteStore 自管；取最新值回传（单用户串行推送下无歧义）
        return {"hash": self.store.read(subject, path).hash, "rev": self.store.manifest(subject).rev}

    def delete(self, subject: str, path: str, base_hash: str) -> None:
        self._check_b64url("path", path)
        self._check_base_hash(base_hash)
        self.store.delete(subject, path, base_hash)
