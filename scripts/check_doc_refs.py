"""文档章节引用校验：代码注释里的 `DESIGN.md §N` / `ARCHITECTURE.md §N` / `API.md §N`
必须在对应文档中存在同号标题——文档裁剪时用它防止打断引用。

运行：python scripts/check_doc_refs.py（CI 可选接入）
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = {
    "DESIGN": ROOT / "docs" / "DESIGN.md",
    "ARCHITECTURE": ROOT / "docs" / "ARCHITECTURE.md",
    "API": ROOT / "docs" / "API.md",
}
SKIP_DIRS = {"node_modules", "dist", "target", "__pycache__", ".git", ".venv", "gen"}
TEXT_SUFFIXES = {".ts", ".tsx", ".py", ".rs", ".sh", ".md", ".yaml", ".yml", ".cjs", ".json"}
TEXT_NAMES = {"Dockerfile", "Dockerfile.web", "Makefile", "compose.yaml"}

REF_RE = re.compile(r"(DESIGN|ARCHITECTURE|API)\.md?\s*§\s*(\d+(?:\.\d+)?)")
HEADING_RE = re.compile(r"^#{2,4}\s+(\d+(?:\.\d+)?)[\s.．]")


def headings(path: Path) -> set[str]:
    found: set[str] = set()
    for line in path.read_text(encoding="utf-8").split("\n"):
        m = HEADING_RE.match(line)
        if m:
            found.add(m.group(1))
    return found


def iter_files():
    for sub in ("src", "docs", ".github"):
        base = ROOT / sub
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file() or any(part in SKIP_DIRS for part in p.parts):
                continue
            if p.suffix in TEXT_SUFFIXES or p.name in TEXT_NAMES:
                yield p
    for name in ("README.md", "Makefile", "compose.yaml", "Dockerfile", "Dockerfile.web"):
        p = ROOT / name
        if p.is_file():
            yield p


def main() -> int:
    heads = {k: headings(v) for k, v in DOCS.items()}
    bad: list[str] = []
    checked = 0
    for path in iter_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        for m in REF_RE.finditer(text):
            checked += 1
            doc, num = m.group(1), m.group(2)
            if num not in heads[doc]:
                rel = path.relative_to(ROOT)
                bad.append(f"{rel}: 引用 {doc}.md §{num} 但该章节不存在")
    if bad:
        print("\n".join(bad))
        print(f"FAIL：{len(bad)} 处失效引用（共检查 {checked} 处）")
        return 1
    print(f"ok：{checked} 处章节引用全部有效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
