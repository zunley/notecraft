/**
 * 同步编解码统一函数——加密的唯一边界（ARCHITECTURE.md §8 纪律 2）。
 *
 * encode/decode 委托 crypto/envelope（AES-256-GCM），换算法/升级信封
 * 只改 envelope 与本文件，manifest 与 API 协议零改动。
 * hash 一律为「传输字节（密文）的哈希」——与服务端同源定义
 * （服务端 sha256(base64url 解码后的密文字节)，hex 小写），
 * 密文哈希天然满足乐观锁一致性（DESIGN.md §6.4）。
 *
 * ★ 本地磁盘永远是明文（文件即真相）；加密只发生在数据离开设备的这一个边界上。
 * ★ 内容密文按 4KiB 对齐填充（掩蔽真实长度，DESIGN.md §6.4 泄露面）：
 *   填充在明文尾部补 '\0'（Markdown 不含 NUL，解码时剥除）。
 */
import { b64urlDecode, decrypt, encrypt } from "../crypto/envelope";
import { contentKey, pathKey, pathNonce } from "../crypto/keystore";

const BLOCK = 4096;
/** NC1 信封固定开销：3(前缀) + 12(nonce) + 16(tag) */
const ENVELOPE_OVERHEAD = 3 + 12 + 16;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 写出/传输前编码：明文 → 4KiB 对齐的信封密文（base64url） */
export async function encodeContent(plain: string): Promise<string> {
  const ptBytes = new TextEncoder().encode(plain).length;
  const pad = (BLOCK - ((ENVELOPE_OVERHEAD + ptBytes) % BLOCK)) % BLOCK;
  const padded = pad ? plain + "\0".repeat(pad) : plain;
  return encrypt(contentKey(), padded);
}

/** 读入/传输后解码：信封密文 → 明文（剥除对齐填充） */
export async function decodeContent(wire: string): Promise<string> {
  return (await decrypt(contentKey(), wire)).replace(/\0+$/, "");
}

/**
 * 路径编解码（确定性加密：同一路径恒同一密文，服务端据此定位文件）。
 * 不做 4KiB 填充——路径等值泄露面已在 DESIGN.md §6.6 坦白接受。
 */
export async function encodePath(path: string): Promise<string> {
  return encrypt(pathKey(), path, await pathNonce(path));
}

export async function decodePath(wire: string): Promise<string> {
  return decrypt(pathKey(), wire);
}

/** 传输字节的哈希（sha256/hex）——本地与服务端必须同源此定义 */
export async function hashWire(wire: string): Promise<string> {
  const raw = b64urlDecode(wire);
  return toHex(await crypto.subtle.digest("SHA-256", raw));
}
