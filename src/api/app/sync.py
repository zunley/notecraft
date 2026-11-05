"""同步：manifest + 文件推拉 + 乐观锁（协议 v1，见 DESIGN-V2 §5）。

TODO:
- GET  /api/sync/manifest      {rev, files:[{path, hash, mtime, size}]}（增量缓存）
- GET  /api/sync/file?path=    {content, hash, mtime}
- PUT  /api/sync/file          {path, content, base_hash}；hash 不符 → 409
- rev 单调递增；内容变更由客户端推送触发
- 命名空间从第一天按 token sub 隔离（单用户时即 <sub>/ 前缀）
- hash = 传输字节的 sha256（加密留缝：服务端不理解明文，见 DESIGN-V2 §5.6）
"""
