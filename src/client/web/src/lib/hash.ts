/** 哈希工具——本地明文 hash 的唯一实现（传输字节的密文哈希在 sync/codec.ts）。 */

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** utf-8 字节的 sha256（十六进制）——StorageAdapter 的本地乐观锁 hash 与此同源 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}
