"""同步路由（薄壳）。

TODO:
- GET  /api/sync/manifest   （core.sync）
- GET  /api/sync/file?path=
- PUT  /api/sync/file       {path, content, base_hash}；hash 不符 → 409
- 全部经 require_user 取 sub 作为命名空间
"""
