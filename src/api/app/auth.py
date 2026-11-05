"""认证：username + password → token（HMAC-SHA256，payload 含 sub）。

TODO:
- POST /api/auth/login   {username, password} → {token, expires_at}
- POST /api/auth/refresh 续期（sub 不变）
- 登录限速沿用 v1
- require_user 鉴权中间件：验签 → 解 sub → 挂请求上下文
  ★ 这是后期多用户模式的唯一切换点，业务代码不得出现「单用户假设」分支
"""
