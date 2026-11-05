"""同步用例：manifest 组装、文件推拉、删除、乐观锁判定、rev 单调递增。

服务端全程只见密文（DESIGN.md §6.4）——不理解、也不尝试理解任何明文语义。

TODO:
- manifest 增量缓存；每次该用户推送成功后其专属 rev 自增（不跨用户）
- 写入：base_hash 不符 → 抛 errors.ConflictError（api 层翻译 409，客户端处理冲突副本）
- 配额：超 NOTE_MD_FILE_MAX → PayloadTooLargeError；超用户存储配额 → QuotaExceededError
  （字节统计由 NoteStore 自管，core 只翻译错误）
- 命名空间按 sub（uid）隔离——天然多租户，加用户 = 加目录，协议与客户端零改动
- hash = 传输字节（密文）的 sha256——密文哈希天然满足乐观锁一致性
- 协议版本：manifest 响应预留 protocol 字段（见 ARCHITECTURE.md §10 协议演进约定）
- 依赖注入：__init__(store: NoteStore)
"""
