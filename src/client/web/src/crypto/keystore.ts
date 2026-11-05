/**
 * keystore——唯一持密模块（DESIGN.md §6.2 / §6.3）。
 *
 * 单口令，登录即解锁，加密对用户无感：
 *
 *   口令 ──Argon2id(salt)──► root
 *     ├─ HKDF(root, "login") → L   登录凭证，发服务端（服务端只存 hash(L)）
 *     └─ HKDF(root, "enc")   → KEK 解开服务端返回的 protected_key → MK
 *
 * MK（随机 256bit 主密钥）常驻内存、不落盘：
 *   内容密钥 → 笔记密文；路径密钥 → 路径密文；（预留）设备/分享密钥。
 * 换口令只重新封装 protected_key，笔记一个字节不用重加密。
 *
 * ★ 其他模块不接触 KEK/MK，只调用本模块接口（ARCHITECTURE.md §8 纪律 3）。
 */

// TODO: deriveLogin( username, password ): Promise<{ loginCredential: string; kek: CryptoKey }>
// TODO: unlock(username, password, protectedKey): Promise<void>  —— 解出 MK 常驻内存
// TODO: isUnlocked(): boolean
// TODO: contentKey() / pathKey(): CryptoKey —— 供 envelope 使用
// TODO: 注册时：generateMasterKey() + exportRecoveryKey()（REK 恢复密钥文件，一次性导出）
// TODO: Argon2id 用 WASM 实现（argon2-browser 或等价物），参数六端一致
