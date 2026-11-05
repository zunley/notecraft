/**
 * 加密信封（envelope）：内容与路径的 AES-256-GCM 加解密（DESIGN.md §6.4）。
 *
 * 信封格式：NC1 | nonce(12B) | 密文 | GCM tag(16B)，外层 base64 后进 JSON 字符串。
 * - NC1 为版本前缀，算法迁移时新旧并行读、逐步回写；
 * - 每次写入独立随机 nonce；
 * - 路径与内容共用同一套编解码（路径也是密文，服务端看不到目录结构）。
 *
 * ★ 本模块与 keystore 是仅有的两处接触密钥材料的代码（ARCHITECTURE.md §8 纪律 3）。
 */

// TODO: encrypt(key: CryptoKey, plain: string): Promise<string>
// TODO: decrypt(key: CryptoKey, wire: string): Promise<string>
// TODO: 路径密文需确定性（同一路径恒同一密文，服务端据此定位文件）——nonce 派生自 HMAC(pathKey, path)
