"""同步路由（薄壳）。服务端只见密文（DESIGN.md §6.4），规格见 docs/API.md §4。

TODO:
- GET    /api/sync/manifest   （core.sync；path 为路径密文，rev 为该用户专属）
- GET    /api/sync/file?path=
- PUT    /api/sync/file       {path, content, base_hash}；hash 不符 → 409
- DELETE /api/sync/file?path=&base_hash=   删除/重命名原语（幂等 204）
- 全部经 require_user 取 sub（uid）作为命名空间
"""
