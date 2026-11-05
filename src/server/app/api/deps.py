"""鉴权依赖（FastAPI Depends）：require_user。

TODO:
- 从 Authorization: Bearer 解出 token → 验签 → 解 payload
- 将 sub 挂到请求上下文（request.state.user），供 core 用例读取
- ★ 这是后期多用户模式的唯一切换点（DESIGN-V2 §6.1）：
  业务代码只依赖上下文中的用户身份，不得出现任何「单用户假设」分支
- 除 /health 外全部业务接口统一收口到本依赖
"""
