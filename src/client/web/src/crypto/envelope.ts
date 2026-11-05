/**
 * 加密信封（envelope）：内容与路径的 AES-256-GCM 加解密（DESIGN.md §6.4）。
 *
 * 信封格式：NC1 | nonce(12B) | 密文 | GCM tag(16B)，外层 base64url 后进 JSON 字符串。
 * - NC1 为版本前缀，算法迁移时新旧并行读、逐步回写；
 * - 内容：每次写入独立随机 nonce；
 * - 路径：确定性 nonce（由 keystore.pathNonce 派生，同一路径恒同一密文，
 *   服务端据此定位文件——泄露面见 DESIGN.md §6.6，已接受）；
 * - 本模块与 keystore 是仅有的两处接触密钥材料的代码（ARCHITECTURE.md §8 纪律 3）。
 *
 * ★ 本模块是纯函数：密钥入参出、不持任何状态；状态只在 keystore。
 */

/** WebCrypto BufferSource 兼容的字节数组（TS 5.7+ 泛型 TypedArray） */
export type Bytes = Uint8Array<ArrayBuffer>;

const MAGIC: Bytes = new Uint8Array([0x4e, 0x43, 0x31]); // "NC1"
const IV_LEN = 12;
const TAG_LEN = 16; // WebCrypto AES-GCM 默认附加在密文尾部

export function b64urlEncode(bytes: Bytes): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Bytes {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Bytes[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * 明文 → 信封密文（base64url）。
 * @param iv 确定性 nonce（路径用）；缺省为每次随机（内容用）
 */
export async function encrypt(key: CryptoKey, plain: string, iv?: Bytes): Promise<string> {
  const nonce = iv ?? crypto.getRandomValues(new Uint8Array(IV_LEN));
  if (nonce.length !== IV_LEN) throw new Error("envelope: nonce 必须为 12 字节");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plain)),
  );
  return b64urlEncode(concat(MAGIC, nonce, ciphertext));
}

/** 信封密文（base64url）→ 明文；版本前缀不符直接拒绝（算法迁移时在此并行读） */
export async function decrypt(key: CryptoKey, wire: string): Promise<string> {
  const raw = b64urlDecode(wire);
  if (raw.length < MAGIC.length + IV_LEN + TAG_LEN) throw new Error("envelope: 密文过短");
  for (let i = 0; i < MAGIC.length; i++) {
    if (raw[i] !== MAGIC[i]) throw new Error("envelope: 版本前缀不匹配（预期 NC1）");
  }
  const nonce = raw.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const ciphertext = raw.subarray(MAGIC.length + IV_LEN);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
