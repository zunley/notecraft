"""HTTP 传输层（薄壳）：解析请求 → 调用 core 用例 → 组装响应。

规则：不含业务规则、不直接触碰 adapters，只依赖 core 与 deps。

路由汇总：main.py 只 include 本文件导出的 api_router。

TODO:
- api_router = APIRouter()，挂载：
    auth_router   （./auth.py）   prefix="/api/auth"
    sync_router   （./sync.py）   prefix="/api/sync"
    relay_router  （./relay.py）  prefix="/api/ai/v1"
    health_router （./health.py） 免鉴权
"""
# from fastapi import APIRouter
# api_router = APIRouter()
