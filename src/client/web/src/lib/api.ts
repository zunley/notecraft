/**
 * 服务端 API 客户端——只覆盖 v2 保留的三组接口（DESIGN-V2 §4.2）：
 * /api/auth/*、/api/sync/*、/api/ai/v1/*（+ /health）。
 *
 * TODO: 与旧版 api.ts 的区别：文件读写、搜索、chat 等调用全部改走本地 StorageAdapter，
 * 本文件不再出现任何 /api/files/*、/api/search 调用。
 */

// TODO: login(username, password) / refresh()
// TODO: syncManifest() / syncGet(path) / syncPut(path, content, baseHash)
