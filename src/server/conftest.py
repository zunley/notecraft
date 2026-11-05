"""pytest 根配置：保证 `import app` 可用（从任意工作目录运行皆可）。"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
