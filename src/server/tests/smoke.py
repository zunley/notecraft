"""后端冒烟测试（占位）。

TODO: 覆盖 login → sync manifest/推拉/409 → relay 假上游透传 → /health。
运行方式：make test（或 python src/server/tests/smoke.py）。

测试结构（实现期固化，防止分层在测试里腐化）：
- tests/unit/core/        # core 用例单测：纯 Python，fake ports（Protocol 原生可替）
- tests/integration/api/  # HTTP 集成测试：dependency_overrides 注入 fake adapters
"""


def main() -> None:
    raise SystemExit("smoke test 尚未实现（骨架阶段）")


if __name__ == "__main__":
    main()
