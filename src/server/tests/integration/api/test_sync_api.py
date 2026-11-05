"""HTTP 集成测试（sync）：API.md §4 全端点 + 乐观锁 + 配额 + 零知识验收。

★ 零知识验收（M3 出口标准）：用真实 NC1 信封（AES-256-GCM）加密内容与路径后推上服务端，
  再直接检查 /notes 卷——任何明文（含路径）都不得出现。
"""

from __future__ import annotations

import base64
import json
import os

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def b64(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


@pytest.fixture()
def client(tmp_path) -> TestClient:  # noqa: ANN001
    settings = Settings(
        registration="open",
        data_dir=tmp_path / "data",
        notes_root=tmp_path / "notes",
        token_secret="sync-test",
        auth_rate=100,
    )
    with TestClient(create_app(settings)) as c:
        c.notes_root = tmp_path / "notes"  # 供零知识验收直接查卷
        yield c


def login(client: TestClient, username: str = "alice") -> dict:
    client.post(
        "/api/auth/register",
        json={"username": username, "password": b64("L1"), "protected_key": b64("pk")},
    )
    token = client.post(
        "/api/auth/login", json={"username": username, "password": b64("L1")}
    ).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def nc1_encrypt(key: bytes, nonce: bytes, plaintext: bytes) -> str:
    """真实 NC1 信封：NC1 | nonce(12B) | AES-256-GCM 密文+tag（DESIGN.md §6.4）。"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    ct = AESGCM(key).encrypt(nonce, plaintext, None)
    return base64.urlsafe_b64encode(b"NC1" + nonce + ct).decode().rstrip("=")


# ── 推拉与乐观锁 ──────────────────────────────────────────────


def test_put_get_manifest_roundtrip(tmp_path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as c:
        h = login(c)
        path, content = b64("enc-path-journal"), b64("enc-content-1")

        resp = c.put("/api/sync/file", json={"path": path, "content": content, "base_hash": ""}, headers=h)
        assert resp.status_code == 200
        body = resp.json()
        assert body["rev"] == 1
        assert len(body["hash"]) == 64  # sha256 hex

        m = c.get("/api/sync/manifest", headers=h).json()
        assert m["protocol"] == 1
        assert m["rev"] == 1
        assert m["files"] == [{"path": path, "hash": body["hash"], "mtime": m["files"][0]["mtime"], "size": len(b64dec(content))}]

        got = c.get("/api/sync/file", params={"path": path}, headers=h).json()
        assert got["content"] == content
        assert got["hash"] == body["hash"]

        # 更新：base_hash = 上次密文哈希 → rev +1
        resp2 = c.put(
            "/api/sync/file",
            json={"path": path, "content": b64("enc-content-2"), "base_hash": body["hash"]},
            headers=h,
        )
        assert resp2.status_code == 200
        assert resp2.json()["rev"] == 2


def b64dec(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def test_conflict_409(tmp_path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as c:
        h = login(c)
        path = b64("p")
        c.put("/api/sync/file", json={"path": path, "content": b64("v1"), "base_hash": ""}, headers=h)
        resp = c.put(
            "/api/sync/file",
            json={"path": path, "content": b64("v2"), "base_hash": "0" * 64},
            headers=h,
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "conflict"


def test_get_missing_404(tmp_path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as c:
        h = login(c)
        resp = c.get("/api/sync/file", params={"path": b64("missing")}, headers=h)
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "not_found"


def test_delete_idempotent_and_conflict(tmp_path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as c:
        h = login(c)
        path = b64("p")
        put = c.put("/api/sync/file", json={"path": path, "content": b64("c"), "base_hash": ""}, headers=h).json()

        bad = c.delete("/api/sync/file", params={"path": path, "base_hash": "0" * 64}, headers=h)
        assert bad.status_code == 409

        ok = c.delete("/api/sync/file", params={"path": path, "base_hash": put["hash"]}, headers=h)
        assert ok.status_code == 204
        again = c.delete("/api/sync/file", params={"path": path, "base_hash": "0" * 64}, headers=h)
        assert again.status_code == 204  # 幂等
        assert c.get("/api/sync/manifest", headers=h).json()["files"] == []


def test_sync_requires_auth(tmp_path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as c:
        assert c.get("/api/sync/manifest").status_code == 401
        assert c.put("/api/sync/file", json={"path": "a", "content": "b", "base_hash": ""}).status_code == 401


def test_invalid_b64_fields_400(tmp_path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as c:
        h = login(c)
        for body in (
            {"path": "not base64!!", "content": b64("c"), "base_hash": ""},
            {"path": b64("p"), "content": "has space", "base_hash": ""},
        ):
            resp = c.put("/api/sync/file", json=body, headers=h)
            assert resp.status_code == 400
            assert resp.json()["error"]["code"] == "invalid_request"


def test_file_max_413(tmp_path) -> None:
    settings = _settings(tmp_path, file_max=64)
    with TestClient(create_app(settings)) as c:
        h = login(c)
        resp = c.put(
            "/api/sync/file",
            json={"path": b64("p"), "content": b64("x" * 200), "base_hash": ""},
            headers=h,
        )
        assert resp.status_code == 413
        assert resp.json()["error"]["code"] == "payload_too_large"


def test_storage_quota_507(tmp_path) -> None:
    settings = _settings(tmp_path, storage_quota=128)
    with TestClient(create_app(settings)) as c:
        h = login(c)
        assert (
            c.put("/api/sync/file", json={"path": b64("p1"), "content": b64("a" * 100), "base_hash": ""}, headers=h).status_code
            == 200
        )
        resp = c.put(
            "/api/sync/file", json={"path": b64("p2"), "content": b64("b" * 100), "base_hash": ""}, headers=h
        )
        assert resp.status_code == 507
        assert resp.json()["error"]["code"] == "storage_quota_exceeded"


def test_namespace_isolation(tmp_path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as c:
        alice = login(c, "alice")
        bob = login(c, "bob")
        c.put("/api/sync/file", json={"path": b64("p"), "content": b64("alice-secret"), "base_hash": ""}, headers=alice)
        m = c.get("/api/sync/manifest", headers=bob).json()
        assert m["files"] == []  # 用户间互不可见
        assert c.get("/api/sync/file", params={"path": b64("p")}, headers=bob).status_code == 404


# ── 零知识验收（M3 出口）──────────────────────────────────────


def test_zero_knowledge_store_has_no_plaintext(tmp_path) -> None:
    """打开服务器卷看不到任何明文（含路径）——用真实 NC1 信封推上服务端后直接查盘。"""
    settings = _settings(tmp_path)
    with TestClient(create_app(settings)) as c:
        h = login(c)
        uid = json.loads(
            next((settings.users_dir).glob("*.json")).read_text()
        )["uid"]

        key = os.urandom(32)
        nonce = os.urandom(12)
        plaintext = "绝密笔记内容：机密计划 2025"
        plain_path = "私密/机密计划.md"

        enc_path = nc1_encrypt(key, os.urandom(12), plain_path.encode())
        enc_content = nc1_encrypt(key, nonce, plaintext.encode())

        resp = c.put(
            "/api/sync/file",
            json={"path": enc_path, "content": enc_content, "base_hash": ""},
            headers=h,
        )
        assert resp.status_code == 200

        # 回读：客户端视角仍是密文（服务端不理解）
        got = c.get("/api/sync/file", params={"path": enc_path}, headers=h).json()
        assert got["content"] == enc_content
        assert plaintext not in base64.urlsafe_b64decode(
            got["content"] + "=" * (-len(got["content"]) % 4)
        ).decode("latin-1")  # 解码后是 NC1|nonce|密文，非明文

        # ★ 直接检查 /notes 卷：文件名、文件内容、meta 均无明文
        ns = settings.notes_root / uid
        assert ns.is_dir(), "应存在 <uid>/ 命名空间"
        for dirpath, _dirs, filenames in os.walk(settings.notes_root):
            for name in filenames:
                full = os.path.join(dirpath, name)
                assert plain_path not in name and "机密" not in name
                data = open(full, "rb").read()
                assert plaintext.encode() not in data, f"{full} 泄露明文"
                assert plain_path.encode() not in data, f"{full} 泄露路径"
        # 路径密文作为 blob 文件名存在，且内容是密文
        blob = ns / "files" / enc_path
        assert blob.is_file()


def _settings(tmp_path, **overrides) -> Settings:
    return Settings(
        registration="open",
        data_dir=tmp_path / "data",
        notes_root=tmp_path / "notes",
        token_secret="sync-test",
        auth_rate=100,
        **overrides,
    )
