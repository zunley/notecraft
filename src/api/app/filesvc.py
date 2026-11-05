"""服务端同步副本操作（内部模块，无对外文件 API）。

沿用 v1 filesvc 语义，仅服务同步：
- 路径防护（防穿越）、CRUD、乐观锁（hash 比对）、.trash/ 回收站
- 面向客户端编辑的 /api/files/*、/api/search 已在 v2 删除（DESIGN-V2 §4.1）
"""
