"""架构测试：Python 侧的分层铁律（TS 侧由 dependency-cruiser 覆盖，ARCHITECTURE.md §4）。

用 AST 判定真实 import（不误伤注释/文档字符串里的字眼）：
- core/ 纯 Python：禁止 import fastapi（用例层不碰 HTTP 框架）；
- api/ 只依赖 core：禁止 import adapters；
- 装配只发生在 main.py：除 main 外禁止 app 模块 import adapters。
"""

from __future__ import annotations

import ast
from pathlib import Path

SERVER = Path(__file__).resolve().parents[2]
APP = SERVER / "app"


def _imported_modules(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.append(node.module)
    return modules


def _app_sources(sub: str) -> list[Path]:
    target = APP / sub
    return sorted(target.glob("*.py")) if target.is_dir() else [target]


def test_core_does_not_import_fastapi() -> None:
    for path in _app_sources("core"):
        for module in _imported_modules(path):
            assert not module.startswith("fastapi"), (
                f"{path.name} 违反铁律：core 禁止 import fastapi（只依赖 ports）"
            )


def test_api_does_not_import_adapters() -> None:
    for path in _app_sources("api"):
        for module in _imported_modules(path):
            assert "adapters" not in module.split("."), (
                f"{path.name} 违反铁律：api 禁止直接触碰 adapters"
            )


def test_only_main_references_adapters() -> None:
    """core/、api/、契约层之外，仅 main.py（组装根）可以 import adapters。"""
    exempt = {"main.py"} | {p.name for p in (APP / "adapters").glob("*.py")}
    for path in sorted(APP.rglob("*.py")):
        if path.name in exempt or "adapters" in path.parts:
            continue
        for module in _imported_modules(path):
            assert "adapters" not in module.split("."), (
                f"{path.relative_to(APP)} 违反铁律：adapters 只允许在 main.py 装配"
            )
