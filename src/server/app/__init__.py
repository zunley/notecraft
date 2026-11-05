"""notecraft 服务端（FastAPI，瘦身版）。

本目录是 Python 包边界（导入根，uvicorn app.main:app --app-dir src/server）：
包内只放可导入代码，requirements.txt / tests/ 在包外；包层同时避免
app.types 等顶层名遮蔽标准库（拍平后 types.py 会遮蔽 stdlib types）。

分层结构（见 docs/ARCHITECTURE.md）：
    api/（HTTP 薄壳） → core/（用例） → ports（Protocol 接缝） ← adapters/（实现）
依赖单向，由 main.py 组装注入。
"""
