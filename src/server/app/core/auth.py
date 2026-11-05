"""认证用例：口令校验、token 签发/校验/续期、登录限速。

TODO:
- token：HMAC-SHA256 自实现（沿用 v1 结构），payload 含 sub = username；TTL 可配、refresh 滚动
- 凭据校验走 ports.Credentials（本期 EnvCredentials，远期换用户表，见 §6.2 ①）
- 登录限速沿用 v1
- 依赖注入：__init__(credentials: Credentials, secret: str, ttl: ...)
"""
