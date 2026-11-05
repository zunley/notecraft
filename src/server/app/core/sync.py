"""同步用例：manifest 组装、文件推拉、乐观锁判定、rev 单调递增。

TODO:
- manifest 增量缓存；每次客户端推送成功后 rev 自增
- 写入：base_hash 不符 → 抛 errors.ConflictError（api 层翻译 409，客户端处理冲突副本）
- 命名空间从第一天按 sub 隔离（单用户时即 <subject>/ 前缀）——
  多用户切换时协议与路径不变，只换 Credentials 实现 + 存储前缀
- hash = 传输字节的 sha256（加密留缝：服务端不理解明文，§5.6）
- 协议版本：manifest 响应预留 protocol 字段（见 ARCHITECTURE.md §10 协议演进约定）
- 依赖注入：__init__(store: NoteStore)
"""
