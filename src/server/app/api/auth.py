"""认证路由（薄壳）。零知识流程见 DESIGN.md §6.3，规格见 docs/API.md §3。

TODO:
- GET  /api/auth/policy   免鉴权：{registration: open|invite|closed}
- POST /api/auth/register 免鉴权（限速）：{username, password, protected_key, invite?}
                         → 201 {token, expires_at}（注册即登录）
- POST /api/auth/login   免鉴权（限速）：{username, password} → {token, expires_at, protected_key}
                         （password 字段 = 客户端派生的登录凭证 L，服务端只校验哈希）
- POST /api/auth/refresh 续期（sub 不变）
- PUT  /api/auth/key     换口令（Bearer）{password, new_password, new_protected_key}
                         ——必须带旧口令，防 token 被盗者改锁死账号
- DELETE /api/auth/account 注销（Bearer）{password} → 删记录 + NoteStore.purge + token 即时失效
"""
