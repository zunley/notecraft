"""NoteStore 实现：/notes 下按 <subject>/ 命名空间维护同步副本（只存密文）。

服务端视角下笔记本就是密文 blob 仓库：路径防护 / CRUD / 乐观锁语义照照旧，
但 content 与 path 均为客户端加密后的传输字节，hash = 密文的 sha256——
永远不做任何明文语义处理（DESIGN.md §6.4）。

★ 自管每用户 rev 与字节统计（存储配额判定）——数据一致性规则就近归本适配器，
  不回流 core（ARCHITECTURE.md §4 显式豁免）。

当前实现（阶段 2）：purge（注销清空该用户全部密文）——认证注销即需要。
manifest / read / write / delete / rev 与配额在阶段 5（M3 同步）落地。
"""

from __future__ import annotations

import shutil
from pathlib import Path

from ..types import Manifest, StoredFile


class FileNoteStore:
    def __init__(self, root: Path | str, file_max: int, storage_quota: int):
        self.root = Path(root)
        self.file_max = file_max
        self.storage_quota = storage_quota
        self.root.mkdir(parents=True, exist_ok=True)

    def _namespace(self, subject: str) -> Path:
        # subject = token sub = 注册时的 16 字节 hex uid——形状校验兜底，防穿越
        if not all(c in "0123456789abcdef" for c in subject) or len(subject) != 32:
            raise ValueError(f"invalid subject: {subject!r}")
        return self.root / subject

    def purge(self, subject: str) -> None:
        """注销：删除该用户全部密文（不可恢复）。"""
        shutil.rmtree(self._namespace(subject), ignore_errors=True)

    # ── 阶段 5（M3 同步）实现 ──────────────────────────────────

    def manifest(self, subject: str) -> Manifest:
        raise NotImplementedError("FileNoteStore.manifest 阶段 5（M3）实现")

    def read(self, subject: str, path: str) -> StoredFile | None:
        raise NotImplementedError("FileNoteStore.read 阶段 5（M3）实现")

    def write(self, subject: str, path: str, content: str, base_hash: str) -> StoredFile:
        raise NotImplementedError("FileNoteStore.write 阶段 5（M3）实现")

    def delete(self, subject: str, path: str, base_hash: str) -> None:
        raise NotImplementedError("FileNoteStore.delete 阶段 5（M3）实现")
