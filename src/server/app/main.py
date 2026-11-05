"""组装根（composition root）：创建 FastAPI 实例、装配依赖、注册路由。

依赖方向（架构铁律）：
    api/ → core/ → ports ← adapters/
- api/   只做 HTTP 解析、校验、响应，调用 core 用例，不含业务规则
- core/  用例编排，纯 Python，禁止 import fastapi，只依赖 ports 中的 Protocol
- ports  接口契约（依赖倒置的接缝）
- adapters/ 实现 ports，由本文件构造并注入 core

★ 灵活性来源：换实现（用户表凭据、加密同步副本、LLM 直连网关、归档介质）
  只动 adapters/ 与本文件，core/ 与 api/ 零改动——对应 DESIGN-V2 的全部演进切换点。

TODO:
- 构造 adapters（FileNoteStore / EnvCredentials / HttpLlmGateway / FsSessionArchive）→ 装配 core 用例 → 注入 api 路由
  ★ 装配形态（不引 DI 容器）：实例挂 app.state，api 层用 FastAPI Depends 取用；
    测试替换用 dependency_overrides 注入 fake ports，不 monkeypatch
- 注册统一异常处理器：errors.DomainError → HTTP（AuthError→401，NotFoundError→404，ConflictError→409）
- 注册鉴权依赖（api/deps.py require_user），业务接口统一收口
- 注册路由（见 api/__init__.py：auth / sync / relay / health）
- 可选静态托管客户端构建产物（src/client/web/dist），浏览器即开即用
- 中间件挂点（限速/日志/指标等横切能力）：统一在本文件，业务模块不自行挂
"""

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="notecraft", version="0.1.0")

    # TODO: 构造 adapters（FileNoteStore / EnvCredentials / HttpLlmGateway / FsSessionArchive）
    # TODO: 组装 core 用例（auth / sync /relay）→ 实例挂 app.state
    # TODO: app.include_router(api_router)  +  require_user 依赖收口
    # TODO: app.add_exception_handler(errors.DomainError, to_http) 统一错误翻译
    # TODO: 静态托管 src/client/web/dist
    return app


app = create_app()
