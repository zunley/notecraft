"""notecraft 服务端（FastAPI，瘦身版）。

分层结构（见 docs/ARCHITECTURE.md）：
    api/（HTTP 薄壳） → core/（用例） → ports（Protocol 接缝） ← adapters/（实现）
依赖单向，由 main.py 组装注入。
"""
