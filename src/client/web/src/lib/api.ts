/**
 * 服务端 API 客户端——只覆盖服务端保留的四组接口（DESIGN.md §4.2）：
 * /api/auth/*（建号/登录/续期/换口令）、/api/sync/*、/api/ai/v1/*（+ /health）。
 *
 * ★ 本地优先：文件读写、搜索、chat 等一律不走服务端——
 *   本文件不出现任何 /api/files/*、/api/search 调用。
 */

// TODO: policy() / register(username, password, protectedKey) / login() / refresh() / putKey() / deleteAccount(password)
// TODO: syncManifest() / syncGet(path) / syncPut(path, content, baseHash)
// TODO: relay 流式转发（委托 ai/llmTransport 的 RelayTransport）
