"""FastAPI 应用入口：路由注册 + 中间件 + 静态托管。

TODO:
- 注册鉴权中间件 require_user（见 auth.py），全部业务接口统一收口
- 注册路由：/api/auth/*、/api/sync/*、/api/ai/v1/*（见 DESIGN-V2 §4.2）
- 注册 GET /health（免鉴权）
- 可选静态托管 Web 构建产物（src/web/dist），浏览器即开即用
"""

from fastapi import FastAPI

app = FastAPI(title="notecraft", version="0.1.0")

# TODO: app.add_middleware(...)  鉴权中间件
# TODO: app.include_router(auth.router)
# TODO: app.include_router(sync.router)
# TODO: app.include_router(relay.router)
# TODO: app.include_router(health) + 静态托管
