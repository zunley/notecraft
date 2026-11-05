"""后端冒烟测试（make test）。

当前覆盖（阶段 0）：
- 配置加载与默认值（config.py，API.md §7）
- 组装根可构建（main.create_app）

阶段 2 起追加：auth → sync manifest/推拉/409 → relay 假上游透传。
测试结构（实现期固化，防止分层在测试里腐化）：
- tests/unit/core/        # core 用例单测：纯 Python，fake ports（Protocol 原生可替）
- tests/integration/api/  # HTTP 集成测试：dependency_overrides 注入 fake adapters
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import load_settings  # noqa: E402
from app.main import create_app  # noqa: E402


def test_config_defaults() -> None:
    """默认值与 API.md §7 一致；未设置环境时不受宿主环境干扰。"""
    for key in list(os.environ):
        if key.startswith(("NOTE_MD_", "OPENAI_")):
            del os.environ[key]
    s = load_settings()
    assert s.registration == "open"
    assert s.auth_rate == 10
    assert s.file_max == 1 << 20
    assert s.storage_quota == 1 << 30
    assert s.relay_daily_quota == 200
    assert s.token_ttl == 72 * 3600  # NOTE_MD_TOKEN_TTL 默认 72h
    assert str(s.notes_root) == "/notes"
    assert str(s.data_dir) == "/data"


def test_config_env_overrides() -> None:
    os.environ["NOTE_MD_REGISTRATION"] = "invite"
    os.environ["NOTE_MD_TOKEN_TTL"] = "30m"
    os.environ["NOTE_MD_FILE_MAX"] = "2097152"
    try:
        s = load_settings()
        assert s.registration == "invite"
        assert s.token_ttl == 1800
        assert s.file_max == 2097152
    finally:
        for key in ("NOTE_MD_REGISTRATION", "NOTE_MD_TOKEN_TTL", "NOTE_MD_FILE_MAX"):
            os.environ.pop(key, None)


def test_config_rejects_bad_values() -> None:
    os.environ["NOTE_MD_REGISTRATION"] = "sometimes"
    try:
        with assert_raises(ValueError):
            load_settings()
    finally:
        os.environ.pop("NOTE_MD_REGISTRATION", None)


def test_create_app() -> None:
    import tempfile

    from app.config import Settings

    with tempfile.TemporaryDirectory() as tmp:
        settings = Settings(data_dir=Path(tmp) / "data", notes_root=Path(tmp) / "notes", token_secret="s")
        app = create_app(settings)
    assert app.title == "notecraft"


class assert_raises:
    def __init__(self, exc_type: type[BaseException]):
        self.exc_type = exc_type

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return exc_type is not None and issubclass(exc_type, self.exc_type)


def main() -> int:
    tests = [
        test_config_defaults,
        test_config_env_overrides,
        test_config_rejects_bad_values,
        test_create_app,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL  {fn.__name__}: {exc!r}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
