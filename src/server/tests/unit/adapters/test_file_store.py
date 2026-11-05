"""FileNoteStore 单测：密文 blob 仓库的 CRUD / 乐观锁 / 配额 / rev（tmp 目录）。"""

from __future__ import annotations

import base64

import pytest

from app.adapters.file_store import FileNoteStore
from app.errors import ConflictError, PayloadTooLargeError, QuotaExceededError

UID = "a" * 32


def b64(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def make(root, file_max=1 << 20, quota=1 << 30) -> FileNoteStore:
    return FileNoteStore(root, file_max, quota)


def test_write_read_manifest_roundtrip(tmp_path) -> None:
    store = make(tmp_path)
    content = b64("cipher-bytes")
    path = b64("enc-path-1")
    result = store.write(UID, path, content, base_hash="")
    assert result.hash  # 密文的 sha256
    stored = store.read(UID, path)
    assert stored is not None
    assert stored.content == content
    assert stored.hash == result.hash

    m = store.manifest(UID)
    assert m.rev == 1
    assert len(m.files) == 1
    assert m.files[0].path == path
    assert m.files[0].size == len(base64.urlsafe_b64decode(content + "=" * (-len(content) % 4)))


def test_rev_increments_per_write(tmp_path) -> None:
    store = make(tmp_path)
    store.write(UID, b64("p1"), b64("c1"), "")
    store.write(UID, b64("p1"), b64("c2"), store.read(UID, b64("p1")).hash)
    store.write(UID, b64("p2"), b64("c3"), "")
    assert store.manifest(UID).rev == 3


def test_optimistic_lock_conflict(tmp_path) -> None:
    store = make(tmp_path)
    path, content = b64("p"), b64("c")
    store.write(UID, path, content, "")
    with pytest.raises(ConflictError):
        store.write(UID, path, b64("other"), base_hash="0" * 64)
    # 新建但 base_hash 非空（服务端已删）→ 409 语义，客户端走重建流程
    with pytest.raises(ConflictError):
        store.write(UID, b64("gone"), b64("c"), base_hash="0" * 64)


def test_file_max_413(tmp_path) -> None:
    store = make(tmp_path, file_max=16)
    with pytest.raises(PayloadTooLargeError):
        store.write(UID, b64("p"), b64("x" * 100), "")


def test_storage_quota_507(tmp_path) -> None:
    store = make(tmp_path, file_max=1024, quota=64)
    store.write(UID, b64("p1"), b64("a" * 40), "")
    with pytest.raises(QuotaExceededError):
        store.write(UID, b64("p2"), b64("b" * 40), "")  # 40+40 > 64
    # 同文件更新按差额算
    store.write(UID, b64("p1"), b64("a" * 50), store.read(UID, b64("p1")).hash)


def test_delete_idempotent_and_conflict(tmp_path) -> None:
    store = make(tmp_path)
    path = b64("p")
    store.write(UID, path, b64("c"), "")
    with pytest.raises(ConflictError):
        store.delete(UID, path, base_hash="0" * 64)
    store.delete(UID, path, base_hash=store.read(UID, path).hash)
    assert store.manifest(UID).files == []
    store.delete(UID, path, base_hash="0" * 64)  # 不存在 → 幂等 204
    assert store.manifest(UID).rev == 2


def test_rejects_bad_path_cipher(tmp_path) -> None:
    store = make(tmp_path)
    for bad in ("../escape", "a/b", "", "has space", "x" * 5000):
        with pytest.raises(ValueError):
            store.write(UID, bad, b64("c"), "")


def test_namespace_isolation(tmp_path) -> None:
    store = make(tmp_path)
    store.write(UID, b64("p"), b64("secret"), "")
    other = "b" * 32
    assert store.manifest(other).files == []
    assert store.read(other, b64("p")) is None
    store.purge(other)  # 不影响 UID
    assert store.read(UID, b64("p")) is not None
    store.purge(UID)
    assert store.manifest(UID).files == []


def test_invalid_subject_rejected(tmp_path) -> None:
    store = make(tmp_path)
    for bad in ("../x", "short", "A" * 32, "a" * 31):
        with pytest.raises(ValueError):
            store.manifest(bad)
