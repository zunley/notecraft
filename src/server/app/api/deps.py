"""鉴权依赖（FastAPI Depends）：require_user。

- 从 Authorization: Bearer 解出 token → core.authenticate（验签 → 解 sub →
  确认用户仍存在——注销后旧 token 立即失效）；
- 将用户挂到 request.state.user，供路由取用；
- ★ 这是多租户的唯一切换点（API.md §8 隔离不变式）：
  业务代码只依赖上下文中的用户身份，不得出现任何「单用户假设」分支，
  也不存在任何绕过 sub 直接寻址存储的代码路径。
- 除 /health、/api/auth/policy、register、login 外全部业务接口统一收口到本依赖。

★ api 层只依赖 core（不直接触碰 adapters）——本依赖经 app.state.auth（AuthCore）取用。
"""

from __future__ import annotations

from fastapi import Request

from ..core.auth import AuthCore
from ..errors import UnauthorizedError
from ..types import User


def require_user(request: Request) -> User:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise UnauthorizedError("missing bearer token")
    core: AuthCore = request.app.state.auth
    return core.authenticate(header[len("Bearer ") :].strip())
