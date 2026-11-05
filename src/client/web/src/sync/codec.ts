/**
 * 同步编解码统一函数——加密的唯一边界（ARCHITECTURE.md §8 纪律 2）。
 *
 * encode/decode 委托 crypto/envelope（AES-256-GCM），换算法/升级信封
 * 只改 envelope 与本文件，manifest 与 API 协议零改动。
 * hash 一律为「传输字节（密文）的哈希」——密文哈希天然满足乐观锁一致性，
 * 服务端不需要理解任何明文语义（DESIGN.md §6.4）。
 *
 * ★ 本地磁盘永远是明文（文件即真相）；加密只发生在数据离开设备的这一个边界上。
 */

/** 写出/传输前编码：明文 → 信封密文（base64 字符串） */
export async function encodeContent(plain: string): Promise<string> {
  // TODO: 调 crypto/envelope.encrypt（contentKey）
  return plain; // 骨架阶段直通
}

/** 读入/传输后解码：信封密文 → 明文 */
export async function decodeContent(wire: string): Promise<string> {
  // TODO: 调 crypto/envelope.decrypt（contentKey）
  return wire; // 骨架阶段直通
}

/** 传输字节的哈希（sha256）——本地与服务端必须同源此定义 */
export async function hashWire(wire: string): Promise<string> {
  // TODO: WebCrypto sha256
  throw new Error("hashWire 尚未实现（骨架阶段）");
}
