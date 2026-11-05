"""NoteStore 实现：/notes 下按 <subject>/ 命名空间维护同步副本（只存密文）。

服务端视角下笔记本就是密文 blob 仓库：路径防护 / CRUD / 乐观锁语义照旧，
但 content 与 path 均为客户端加密后的传输字节，hash = 密文的 sha256——
永远不做任何明文语义处理（DESIGN.md §6.4）。

磁盘布局（API.md §8）：
    /notes/<uid>/meta.json            {rev, files: {path密文: {hash, mtime, size, bytes}}}
    /notes/<uid>/files/<path密文>      密文 blob（base64url 字符，文件系统安全）

★ 自管每用户 rev 与字节统计（存储配额判定）——数据一致性规则就近归本适配器，
  不回流 core（ARCHITECTURE.md §4 显式豁免）。
★ path 密文是 base64url（无 "/"、无 ".."）——天然防穿越；仍做字符集与长度校验。
★ mtime = 服务端接收时刻按天舍入（真实值在密文内；粗粒度见 DESIGN.md §6.4）。
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from datetime import datetime
from pathlib import Path

from ..errors import ConflictError, PayloadTooLargeError, QuotaExceededError
from ..types import B64URL_RE, Manifest, ManifestEntry, StoredFile

_MAX_PATH_CIPHER = 4096  # 路径密文长度上限（base64url 字符）


def _b64url_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _sha256_hex(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _day_rounded_now() -> float:
    now = datetime.fromtimestamp(time.time())
    return float(int(datetime(now.year, now.month, now.day).timestamp()))


class FileNoteStore:
    def __init__(self, root: Path | str, file_max: int, storage_quota: int):
        self.root = Path(root)
        self.file_max = file_max
        self.storage_quota = storage_quota
        self.root.mkdir(parents=True, exist_ok=True)

    # ── 路径 ──────────────────────────────────────────────────

    def _namespace(self, subject: str) -> Path:
        # subject = token sub = 注册时的 16 字节 hex uid——形状校验兜底，防穿越
        if not all(c in "0123456789abcdef" for c in subject) or len(subject) != 32:
            raise ValueError(f"invalid subject: {subject!r}")
        return self.root / subject

    @staticmethod
    def _check_cipher_path(path: str) -> None:
        if not path or len(path) > _MAX_PATH_CIPHER or not B64URL_RE.fullmatch(path):
            raise ValueError(f"invalid path cipher: {path[:32]!r}")

    def _meta_path(self, ns: Path) -> Path:
        return ns / "meta.json"

    def _files_dir(self, ns: Path) -> Path:
        return ns / "files"

    def _load_meta(self, ns: Path) -> dict:
        try:
            meta = json.loads(self._meta_path(ns).read_text(encoding="utf-8"))
            if not isinstance(meta.get("rev"), int) or not isinstance(meta.get("files"), dict):
                raise ValueError
            return meta
        except (FileNotFoundError, json.JSONDecodeError, ValueError):
            return {"rev": 0, "files": {}}

    def _save_meta(self, ns: Path, meta: dict) -> None:
        ns.mkdir(parents=True, exist_ok=True)
        path = self._meta_path(ns)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
        tmp.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)

    @staticmethod
    def _total_bytes(meta: dict) -> int:
        return sum(int(f.get("bytes", 0)) for f in meta["files"].values())

    # ── NoteStore ─────────────────────────────────────────────

    def manifest(self, subject: str) -> Manifest:
        ns = self._namespace(subject)
        meta = self._load_meta(ns)
        entries = [
            ManifestEntry(path=p, hash=f["hash"], mtime=float(f["mtime"]), size=int(f["size"]))
            for p, f in meta["files"].items()
        ]
        entries.sort(key=lambda e: e.path)
        return Manifest(rev=meta["rev"], files=entries)

    def read(self, subject: str, path: str) -> StoredFile | None:
        ns = self._namespace(subject)
        self._check_cipher_path(path)
        meta = self._load_meta(ns)
        entry = meta["files"].get(path)
        if entry is None:
            return None
        try:
            raw = (self._files_dir(ns) / path).read_bytes()
        except FileNotFoundError:
            return None
        # hash 以磁盘为准（meta 损坏时自愈）
        return StoredFile(
            content=_b64url_encode(raw),
            hash=_sha256_hex(raw),
            mtime=float(entry["mtime"]),
        )

    def write(self, subject: str, path: str, content: str, base_hash: str) -> StoredFile:
        ns = self._namespace(subject)
        self._check_cipher_path(path)
        try:
            raw = _b64url_decode(content)
        except Exception as exc:  # noqa: BLE001 — 形状非法归 core 校验，这里兜底
            raise ValueError(f"invalid content encoding: {exc}") from exc

        if len(raw) > self.file_max:
            raise PayloadTooLargeError(f"file exceeds {self.file_max} bytes")

        meta = self._load_meta(ns)
        current = meta["files"].get(path)
        current_bytes = int(current.get("bytes", 0)) if current else 0

        # 乐观锁（API.md §4）：文件在则比对；不在则要求 base_hash 为空（新建）
        if current is not None:
            if current["hash"] != base_hash:
                raise ConflictError("base_hash mismatch")
        elif base_hash:
            raise ConflictError("base_hash mismatch (file absent)")  # 服务端已删 → 客户端重建

        new_total = self._total_bytes(meta) - current_bytes + len(raw)
        if new_total > self.storage_quota:
            raise QuotaExceededError("storage quota exceeded")

        blob = self._files_dir(ns) / path
        blob.parent.mkdir(parents=True, exist_ok=True)
        tmp = blob.with_name(f"{blob.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
        tmp.write_bytes(raw)
        os.replace(tmp, blob)

        digest = _sha256_hex(raw)
        meta["files"][path] = {
            "hash": digest,
            "mtime": _day_rounded_now(),
            "size": len(raw),
            "bytes": len(raw),
        }
        meta["rev"] = int(meta["rev"]) + 1
        self._save_meta(ns, meta)
        return StoredFile(content=content, hash=digest, mtime=float(meta["files"][path]["mtime"]))

    def delete(self, subject: str, path: str, base_hash: str) -> None:
        ns = self._namespace(subject)
        self._check_cipher_path(path)
        meta = self._load_meta(ns)
        current = meta["files"].get(path)
        if current is None:
            return  # 幂等：文件不存在也成功（API.md §4）
        if current["hash"] != base_hash:
            raise ConflictError("base_hash mismatch")
        (self._files_dir(ns) / path).unlink(missing_ok=True)
        del meta["files"][path]
        meta["rev"] = int(meta["rev"]) + 1
        self._save_meta(ns, meta)

    def purge(self, subject: str) -> None:
        """注销：删除该用户全部密文（不可恢复）。"""
        import shutil

        shutil.rmtree(self._namespace(subject), ignore_errors=True)
