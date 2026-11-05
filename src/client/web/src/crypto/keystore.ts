/**
 * keystore——唯一持密模块（DESIGN.md §6.2 / §6.3）。
 *
 * 单口令，登录即解锁，加密对用户无感：
 *
 *   口令 ──Argon2id(salt=H("notecraft.salt.v1"+username)[0:16])──► root
 *     ├─ HKDF(root, "login") → L   登录凭证，发服务端（服务端只存 hash(L)）
 *     └─ HKDF(root, "enc")   → KEK 解开服务端返回的 protected_key → MK
 *
 * MK（随机 256bit 主密钥）常驻内存、不落盘：
 *   HKDF(MK, "nc1.content") → 内容密钥；HKDF(MK, "nc1.path") → 路径密钥；
 *   HKDF(MK, "nc1.path.nonce") → 路径确定性 nonce 的 HMAC 密钥。
 * 换口令只重新封装 protected_key，笔记一个字节不用重加密。
 *
 * ★ 其他模块不接触 KEK/MK，只调用本模块接口（ARCHITECTURE.md §8 纪律 3）。
 * ★ Argon2id 参数六端一致、不可随意改动（改了所有设备都解不开）：
 *   iterations=3, memory=64MiB, parallelism=1, 输出 32B。
 * ★ REK 恢复密钥文件同时 wrap 了 L 与 MK——忘记口令时才能凭它走
 *   PUT /api/auth/key 重设口令（服务端要求旧 L，API.md §3）。
 */
import { argon2id } from "hash-wasm";
import { b64urlDecode, b64urlEncode, decrypt, encrypt, type Bytes } from "./envelope";

/** Argon2id 参数（六端一致；memorySize 单位 KiB） */
const ARGON2 = { iterations: 3, memorySize: 65536, parallelism: 1, hashLength: 32 } as const;
const SALT_CONTEXT = "notecraft.salt.v1";

interface Vault {
  mk: Bytes;
  content: CryptoKey;
  path: CryptoKey;
  pathMac: CryptoKey;
}

/** ★ 模块级唯一密钥状态：除本文件外无任何代码可达 */
let vault: Vault | null = null;

// ── 基元 ──────────────────────────────────────────────────────

function utf8(text: string): Bytes {
  return new TextEncoder().encode(text);
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function hkdf(ikm: Bytes, info: string, length = 32): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function aesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function deriveRoot(username: string, password: string): Promise<Bytes> {
  const salt = (await sha256(utf8(SALT_CONTEXT + username))).slice(0, 16);
  return (await argon2id({ password: utf8(password), salt, ...ARGON2, outputType: "binary" })) as Bytes;
}

async function setVault(mk: Bytes): Promise<void> {
  const [content, path, pathMac] = await Promise.all([
    hkdf(mk, "nc1.content"),
    hkdf(mk, "nc1.path"),
    hkdf(mk, "nc1.path.nonce"),
  ]);
  vault = {
    mk,
    content: await aesKey(content),
    path: await aesKey(path),
    pathMac: await crypto.subtle.importKey("raw", pathMac, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]),
  };
}

// ── 对外接口 ──────────────────────────────────────────────────

export interface LoginDerivation {
  /** base64url(L)——登录请求的 password 字段（不是口令本身） */
  loginCredential: string;
  /** KEK：解开服务端 protected_key 用（仅调用方短暂持有，用完即弃） */
  kek: CryptoKey;
}

/** 口令 → L + KEK（登录前的本地派生，纯离线） */
export async function deriveLogin(username: string, password: string): Promise<LoginDerivation> {
  const root = await deriveRoot(username, password);
  const [login, kekRaw] = await Promise.all([hkdf(root, "login"), hkdf(root, "enc")]);
  return { loginCredential: b64urlEncode(login), kek: await aesKey(kekRaw) };
}

export interface VaultCreation {
  loginCredential: string;
  /** protected_key = AES-GCM(KEK, MK)——打不开的信封，服务端只负责存与还 */
  protectedKey: string;
  /** REK 恢复密钥文件内容（JSON，一次性导出，离线保存） */
  recoveryKey: string;
}

/** 注册：本地生成 MK → 上传信封 → MK 常驻内存（注册即登录即解锁） */
export async function createVault(username: string, password: string): Promise<VaultCreation> {
  const { loginCredential, kek } = await deriveLogin(username, password);
  const mk = crypto.getRandomValues(new Uint8Array(32));
  const protectedKey = await encrypt(kek, b64urlEncode(mk));
  await setVault(mk);
  const recoveryKey = await wrapRecovery(username, b64urlDecode(loginCredential), mk);
  return { loginCredential, protectedKey, recoveryKey };
}

/** 登录：派生 L 发服务端，拿回 protected_key 用 KEK 解封 → MK 常驻内存 */
export async function unlock(
  username: string,
  password: string,
  protectedKey: string,
): Promise<string> {
  const { loginCredential, kek } = await deriveLogin(username, password);
  await unlockWith(kek, protectedKey);
  return loginCredential;
}

/** 用已派生的 KEK 解封 protected_key（避免二次 Argon2id 开销） */
export async function unlockWith(kek: CryptoKey, protectedKey: string): Promise<void> {
  const mkB64 = await decrypt(kek, protectedKey);
  await setVault(b64urlDecode(mkB64));
}

export function isUnlocked(): boolean {
  return vault !== null;
}

export function lock(): void {
  vault = null;
}

/** 内容密钥——供 envelope/codec 使用（未解锁抛错） */
export function contentKey(): CryptoKey {
  if (!vault) throw new Error("keystore: 尚未解锁");
  return vault.content;
}

/** 路径密钥（确定性加密，同一路径恒同一密文） */
export function pathKey(): CryptoKey {
  if (!vault) throw new Error("keystore: 尚未解锁");
  return vault.path;
}

/** 路径确定性 nonce：HMAC(pathMac, path) 前 12 字节 */
export async function pathNonce(path: string): Promise<Bytes> {
  if (!vault) throw new Error("keystore: 尚未解锁");
  const sig = await crypto.subtle.sign("HMAC", vault.pathMac, utf8(path));
  return new Uint8Array(sig).slice(0, 12);
}

/** 换口令：用新 KEK 重新封装常驻的 MK（笔记密文一个字节都不动） */
export async function rewrapProtectedKey(newKek: CryptoKey): Promise<string> {
  if (!vault) throw new Error("keystore: 尚未解锁");
  return encrypt(newKek, b64urlEncode(vault.mk));
}

// ── REK 恢复密钥文件 ──────────────────────────────────────────

async function wrapRecovery(
  username: string,
  loginBytes: Bytes,
  mk: Bytes,
): Promise<string> {
  const rek = crypto.getRandomValues(new Uint8Array(32));
  const rekKey = await aesKey(rek);
  const payload = {
    v: 1,
    kind: "notecraft-recovery-key",
    username,
    rek: b64urlEncode(rek),
    login: await encrypt(rekKey, b64urlEncode(loginBytes)),
    master: await encrypt(rekKey, b64urlEncode(mk)),
  };
  return JSON.stringify(payload, null, 2);
}

export interface Recovery {
  username: string;
  /** base64url(L)——可直接用于登录 / 重设口令的旧凭证 */
  loginCredential: string;
}

/** 凭 REK 解出 MK（本地解锁）+ L（联网后可登录/重设口令） */
export async function recoverFromRecoveryKey(content: string): Promise<Recovery> {
  let payload: { v?: number; username?: string; rek?: string; login?: string; master?: string };
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error("恢复密钥文件格式错误");
  }
  if (payload.v !== 1 || !payload.rek || !payload.login || !payload.master) {
    throw new Error("恢复密钥文件格式错误");
  }
  const rekKey = await aesKey(b64urlDecode(payload.rek));
  const loginCredential = await decrypt(rekKey, payload.login);
  const mk = b64urlDecode(await decrypt(rekKey, payload.master));
  await setVault(mk);
  return { username: payload.username ?? "", loginCredential };
}
