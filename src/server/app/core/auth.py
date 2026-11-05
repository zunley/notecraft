"""认证用例：注册、登录、续期、换口令、注销（零知识 + 多租户，DESIGN.md §6.3）。

TODO:
- register：校验 username 格式与策略（config.NOTE_MD_REGISTRATION / 邀请码）→
  UserStore.create（username 冲突抛 UsernameTakenError）→ 签发 token（注册即登录）
  ★ 无管理员概念：运营者直接在服务器文件系统操作，不加任何管理接口
- login：UserStore.verify 校验凭证哈希 → 签发 token + 返回 protected_key；
  凭证错误一律 AuthError（不区分用户是否存在，防枚举）
- refresh：滚动续期（sub 不变），不需要口令
- put_key：换口令——校验旧口令，更新 hash(L) 与信封（MK 不变，笔记密文不动）
- delete：校验口令 → UserStore.delete + NoteStore.purge（API.md §3 注销）
- 按 username 的登录/注册限速在本层做（读了 body 才有 username）；
  按 IP 的限速是 main.py 中间件
- token：HMAC-SHA256，payload 含 sub = uid；TTL 可配
- 依赖注入：__init__(users: UserStore, notes: NoteStore, secret: str, ttl: ...)
"""
