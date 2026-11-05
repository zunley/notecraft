"""HTTP 集成测试（relay）：真实 create_app + 本地 mock 上游网关（SSE 透传）。"""

from __future__ import annotations

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

# ── mock 上游（OpenAI 兼容 SSE）────────────────────────────────


class Upstream(BaseHTTPRequestHandler):
    captured: list[dict] = []
    reject_models: set[str] = set()

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        payload = json.loads(self.rfile.read(length))
        type(self).captured.append(payload)

        if payload.get("model") in self.reject_models:
            body = json.dumps(
                {"error": {"message": "model rejected", "type": "invalid_request_error"}}
            ).encode()
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for chunk in (
            b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":" from upstream"}}]}\n\n',
            b"data: [DONE]\n\n",
        ):
            self.wfile.write(chunk)
            self.wfile.flush()

    def log_message(self, *args) -> None:  # noqa: ARG002
        pass


@pytest.fixture()
def upstream():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    Upstream.captured = []
    Upstream.reject_models = set()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


def make_client(tmp_path, upstream_port: int | None = None, **overrides) -> TestClient:
    settings = Settings(
        registration="open",
        data_dir=tmp_path / "data",
        notes_root=tmp_path / "notes",
        token_secret="relay-test",
        auth_rate=100,
        relay_daily_quota=overrides.pop("relay_daily_quota", 100),
        openai_base_url=overrides.pop(
            "openai_base_url", f"http://127.0.0.1:{upstream_port}/v1" if upstream_port else ""
        ),
        openai_api_key=overrides.pop("openai_api_key", "sk-test" if upstream_port else ""),
        openai_model=overrides.pop("openai_model", "server-owned-model"),
        **overrides,
    )
    return TestClient(create_app(settings))


def token_for(client: TestClient, username: str = "alice") -> str:
    b = lambda v: base64.urlsafe_b64encode(v.encode()).decode().rstrip("=")  # noqa: E731
    client.post(
        "/api/auth/register",
        json={"username": username, "password": b("L1"), "protected_key": b("pk1")},
    )
    resp = client.post("/api/auth/login", json={"username": username, "password": b("L1")})
    return resp.json()["token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── 用例 ──────────────────────────────────────────────────────


def test_relay_requires_token(tmp_path, upstream) -> None:
    port = upstream.server_address[1]
    with make_client(tmp_path, port) as c:
        resp = c.post("/api/ai/v1/chat/completions", json={"messages": []})
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "unauthorized"


def test_relay_sse_passthrough_and_model_override(tmp_path, upstream) -> None:
    port = upstream.server_address[1]
    with make_client(tmp_path, port) as c:
        token = token_for(c)
        resp = c.post(
            "/api/ai/v1/chat/completions",
            json={"model": "client-model", "stream": True, "messages": [{"role": "user", "content": "hi"}]},
            headers=auth(token),
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        assert "Hello" in resp.text and "from upstream" in resp.text
        assert resp.text.rstrip().endswith("data: [DONE]")

    # 上游收到：服务端拥有的 model 覆盖 + 字段原样透传
    sent = Upstream.captured[-1]
    assert sent["model"] == "server-owned-model"
    assert sent["messages"] == [{"role": "user", "content": "hi"}]
    assert sent["stream"] is True
    # 零留存：上游 key 只在服务端适配器内（请求体里没有它）
    assert "sk-test" not in json.dumps(sent)


def test_relay_upstream_error_passthrough(tmp_path, upstream) -> None:
    port = upstream.server_address[1]
    Upstream.reject_models.add("server-owned-model")
    with make_client(tmp_path, port) as c:
        token = token_for(c)
        resp = c.post(
            "/api/ai/v1/chat/completions",
            json={"messages": []},
            headers=auth(token),
        )
        assert resp.status_code == 400  # 上游状态码原样
        assert resp.json()["error"]["message"] == "model rejected"  # OpenAI 形状原样


def test_relay_quota_429_with_reset_at(tmp_path, upstream) -> None:
    port = upstream.server_address[1]
    with make_client(tmp_path, port, relay_daily_quota=1) as c:
        token = token_for(c)
        body = {"messages": []}
        assert c.post("/api/ai/v1/chat/completions", json=body, headers=auth(token)).status_code == 200
        resp = c.post("/api/ai/v1/chat/completions", json=body, headers=auth(token))
        assert resp.status_code == 429
        err = resp.json()["error"]
        assert err["code"] == "relay_quota_exceeded"
        assert err["details"]["reset_at"] > 0
        assert int(resp.headers["Retry-After"]) >= 1


def test_relay_gateway_unconfigured_503(tmp_path) -> None:
    with make_client(tmp_path, upstream_port=None) as c:
        token = token_for(c)
        resp = c.post("/api/ai/v1/chat/completions", json={"messages": []}, headers=auth(token))
        assert resp.status_code == 503
        assert resp.json()["error"]["code"] == "upstream_unavailable"


def test_relay_bad_json_400(tmp_path, upstream) -> None:
    port = upstream.server_address[1]
    with make_client(tmp_path, port) as c:
        token = token_for(c)
        resp = c.post(
            "/api/ai/v1/chat/completions",
            content=b"not-json",
            headers={**auth(token), "content-type": "application/json"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_request"
