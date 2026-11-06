"""CORS 集成测试：Web 客户端直连跨源场景（同源代理部署默认不下发 CORS 头）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ORIGIN = "https://app.example.com"


def make_client(tmp_path, **overrides) -> TestClient:
    settings = Settings(
        registration="open",
        data_dir=tmp_path / "data",
        notes_root=tmp_path / "notes",
        token_secret="cors-test",
        auth_rate=100,
        **overrides,
    )
    return TestClient(create_app(settings))


def test_cors_disabled_by_default(tmp_path) -> None:
    """默认（同源代理部署）不下发任何 CORS 头。"""
    with make_client(tmp_path) as c:
        resp = c.get("/health", headers={"Origin": ORIGIN})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers


def test_cors_preflight_for_allowed_origin(tmp_path) -> None:
    with make_client(tmp_path, allowed_origins=(ORIGIN,)) as c:
        resp = c.options(
            "/api/auth/login",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert resp.status_code in (200, 204)
        assert resp.headers["access-control-allow-origin"] == ORIGIN
        assert "authorization" in resp.headers["access-control-allow-headers"].lower()


def test_cors_simple_request_carries_header(tmp_path) -> None:
    with make_client(tmp_path, allowed_origins=(ORIGIN,)) as c:
        resp = c.get("/health", headers={"Origin": ORIGIN})
        assert resp.headers["access-control-allow-origin"] == ORIGIN
        # 其他源不在白名单 → 不下发
        other = c.get("/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in other.headers


def test_cors_wildcard(tmp_path) -> None:
    with make_client(tmp_path, allowed_origins=("*",)) as c:
        resp = c.get("/health", headers={"Origin": ORIGIN})
        assert resp.headers["access-control-allow-origin"] == "*"


def test_cors_origins_env_parsing(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    from app.config import load_settings

    monkeypatch.setenv("NOTE_MD_ALLOWED_ORIGINS", " https://a.example , https://b.example/ ")
    s = load_settings()
    assert s.allowed_origins == ("https://a.example", "https://b.example")  # 去空格、去尾斜杠
