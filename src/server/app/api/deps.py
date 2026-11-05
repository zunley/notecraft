"""鉴权依赖（FastAPI Depends）：require_user。

TODO:
- 从 Authorization: Bearer 解出 token → 验签 → 解 payload
- ★ 确认用户仍存在（UserStore.get(uid)）——注销后旧 token 立即失效
- 将 sub（uid）挂到请求上下文（request.state.user），供 core 用例读取
- ★ 这是多租户的唯一切换点（API.md §8 隔离不变式）：
  业务代码只依赖上下文中的用户身份，不得出现任何「单用户假设」分支，
  也不存在任何绕过 sub 直接寻址存储的代码路径
- 除 /health、/api/auth/policy、register、login 外全部业务接口统一收口到本依赖
"""
