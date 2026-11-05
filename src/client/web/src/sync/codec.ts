/**
 * content 编解码统一函数——加密纪律② 的唯一落点（DESIGN-V2 §5.6）。
 *
 * 当前直通；二期 E2E 时只改本文件：
 * encode/decode 内插入加密，hash 仍是「传输字节的哈希」，
 * manifest 与 API 协议零改动。
 */

/** 写出/传输前编码（当前直通） */
export function encodeContent(plain: string): string {
  return plain;
}

/** 读入/传输后解码（当前直通） */
export function decodeContent(wire: string): string {
  return wire;
}

/** 传输字节的哈希（sha256）——本地与服务端必须同源此定义 */
export async function hashWire(wire: string): Promise<string> {
  // TODO: WebCrypto sha256
  throw new Error("hashWire 尚未实现（骨架阶段）");
}
