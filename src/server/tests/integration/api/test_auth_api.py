"""HTTP 集成测试（auth）：真实 create_app + TestClient，数据目录用 pytest tmp_path。

覆盖 API.md §3 全部端点与 §2 错误码；require_user 走真实 token 流程。
"""

from __future__ import annotations

import base64

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
        token_secret="integration-test",
        auth_rate=100,  # IP 限速让位于被测行为（单独测）
    )
    with TestClient(create_app(settings)) as c:
        yield c


def register(client: TestClient, username: str = "alice", password: str = "L1", pk: str = "pk1", invite=None):
    body = {"username": username, "password": b64(password), "protected_key": b64(pk)}
    if invite is not None:
        body["invite"] = invite
    return client.post("/api/auth/register", json=body)


# ── 健康与策略 ────────────────────────────────────────────────


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_policy_open(client: TestClient) -> None:
    resp = client.get("/api/auth/policy")
    assert resp.status_code == 200
    assert resp.json() == {"registration": "open"}


# ── 注册 ──────────────────────────────────────────────────────


def test_register_201_returns_token(client: TestClient) -> None:
    resp = register(client)
    assert resp.status_code == 201
    body = resp.json()
    assert body["token"] and body["expires_at"] > 0
    assert "protected_key" not in body  # 注册即登录：MK 刚在本地生成，无需回传


def test_register_duplicate_409_username_taken(client: TestClient) -> None:
    register(client)
    resp = register(client)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "username_taken"


def test_register_bad_username_400(client: TestClient) -> None:
    resp = register(client, username="Bad Name")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_request"


def test_register_bad_envelope_400(client: TestClient) -> None:
    resp = client.post(
        "/api/auth/register",
        json={"username": "alice", "password": "not base64!!", "protected_key": "cGs"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_request"


def test_register_closed_403(tmp_path) -> None:
    settings = Settings(
        registration="closed",
        data_dir=tmp_path / "data",
        notes_root=tmp_path / "notes",
        token_secret="t",
    )
    with TestClient(create_app(settings)) as c:
        resp = c.post(
            "/api/auth/register",
            json={"username": "alice", "password": b64("L"), "protected_key": b64("pk")},
        )
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "registration_closed"


def test_register_invite_mode(tmp_path) -> None:
    settings = Settings(
        registration="invite",
        invite_code="sesame",
        data_dir=tmp_path / "data",
        notes_root=tmp_path / "notes",
        token_secret="t",
    )
    with TestClient(create_app(settings)) as c:
        body = {"username": "alice", "password": b64("L"), "protected_key": b64("pk")}
        assert c.post("/api/auth/register", json=body).status_code == 403
        assert c.post("/api/auth/register", json={**body, "invite": "nope"}).status_code == 403
        ok = c.post("/api/auth/register", json={**body, "invite": "sesame"})
        assert ok.status_code == 201


# ── 登录 ──────────────────────────────────────────────────────


def test_login_200_returns_protected_key(client: TestClient) -> None:
    register(client, password="L1", pk="envelope1")
    resp = client.post("/api/auth/login", json={"username": "alice", "password": b64("L1")})
    assert resp.status_code == 200
    body = resp.json()
    assert body["protected_key"] == b64("envelope1")
    assert body["token"]


def test_login_wrong_password_401(client: TestClient) -> None:
    register(client, password="L1")
    resp = client.post("/api/auth/login", json={"username": "alice", "password": b64("nope")})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_credentials"
    # 防枚举：不存在的用户同码同状
    resp2 = client.post("/api/auth/login", json={"username": "nobody", "password": b64("nope")})
    assert resp2.status_code == 401
    assert resp2.json()["error"]["code"] == "invalid_credentials"


# ── refresh / key / account ───────────────────────────────────


def auth_header(client: TestClient, password: str = "L1", username: str = "alice") -> dict:
    register(client, username=username, password=password)
    token = client.post("/api/auth/login", json={"username": username, "password": b64(password)}).json()[
        "token"
    ]
    return {"Authorization": f"Bearer {token}"}


def test_refresh_200_and_requires_auth(client: TestClient) -> None:
    headers = auth_header(client)
    assert client.post("/api/auth/refresh").status_code == 401
    resp = client.post("/api/auth/refresh", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["token"]


def test_refresh_401_after_account_deleted(client: TestClient) -> None:
    headers = auth_header(client, password="L1")
    assert client.request(
        "DELETE", "/api/auth/account", json={"password": b64("L1")}, headers=headers
    ).status_code == 204
    resp = client.post("/api/auth/refresh", headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


def test_put_key_requires_old_password(client: TestClient) -> None:
    headers = auth_header(client, password="L1")
    bad = {"password": b64("wrong"), "new_password": b64("L2"), "new_protected_key": b64("pk2")}
    assert client.put("/api/auth/key", json=bad, headers=headers).status_code == 401

    good = {"password": b64("L1"), "new_password": b64("L2"), "new_protected_key": b64("pk2")}
    assert client.put("/api/auth/key", json=good, headers=headers).status_code == 204
    # 旧凭证失效、新凭证与新信封生效
    assert client.post("/api/auth/login", json={"username": "alice", "password": b64("L1")}).status_code == 401
    new_pk = client.post("/api/auth/login", json={"username": "alice", "password": b64("L2")}).json()
    assert new_pk["protected_key"] == b64("pk2")


def test_delete_account_requires_password(client: TestClient) -> None:
    headers = auth_header(client, password="L1")
    resp = client.request("DELETE", "/api/auth/account", json={"password": b64("nope")}, headers=headers)
    assert resp.status_code == 401
    assert client.post("/api/auth/refresh", headers=headers).status_code == 200  # 账号还在


# ── 限速（按 IP，中间件）──────────────────────────────────────


def test_auth_ip_rate_limit_429(tmp_path) -> None:
    settings = Settings(
        registration="open",
        data_dir=tmp_path / "data",
        notes_root=tmp_path / "notes",
        token_secret="t",
        auth_rate=3,
    )
    with TestClient(create_app(settings)) as c:
        body = {"username": "alice", "password": b64("L1"), "protected_key": b64("pk")}
        for _ in range(3):
            assert c.post("/api/auth/register", json=body).status_code in (201, 409)
        resp = c.post("/api/auth/register", json=body)
        assert resp.status_code == 429
        assert resp.json()["error"]["code"] == "rate_limited"
        assert int(resp.headers["Retry-After"]) >= 1
