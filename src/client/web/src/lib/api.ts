/**
 * 服务端 API 客户端——只覆盖服务端保留的四组接口（DESIGN.md §4.2）：
 * /api/auth/*（建号/登录/续期/换口令/注销）、/api/sync/*、/api/ai/v1/*（+ /health）。
 *
 * ★ 本地优先：文件读写、搜索、chat 等一律不走服务端——
 *   本文件不出现任何 /api/files/*、/api/search 调用。
 * ★ HTTP→领域错误的唯一翻译点：非 2xx 一律经 lib/errors.translateHttpError
 *   转成领域错误抛出；网络不可达抛 OfflineError。features 只 catch 领域错误。
 * ★ relay 的 SSE 流式不在此——归 ai/llmTransport.ts（LLM 调用收敛，§8 纪律 1）。
 */
import { apiUrl, config } from "./config";
import { AuthExpiredError, OfflineError, translateHttpError } from "./errors";

// ── token 存取（transport 关注点；state/auth 负责状态同步）────────

export function getToken(): string {
  try {
    return localStorage.getItem(config.tokenStorageKey) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(config.tokenStorageKey, token);
  } catch {
    // 存不下仅影响刷新后保持登录
  }
  config.relay.apiKey = token;
}

export function clearToken(): void {
  try {
    localStorage.removeItem(config.tokenStorageKey);
  } catch {
    /* ignore */
  }
  config.relay.apiKey = "";
}

// ── 底层请求 ──────────────────────────────────────────────────

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }

  let resp: Response;
  try {
    resp = await fetch(apiUrl(path), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new OfflineError(); // fetch 失败 = 发不出去（断网/DNS）
  }

  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!resp.ok) {
    const err = translateHttpError(resp.status, parsed);
    // token 失效即清（仅针对带 token 的请求），登录页接管
    if (err instanceof AuthExpiredError && opts.auth !== false) clearToken();
    throw err;
  }
  return parsed as T;
}

// ── auth（API.md §3）──────────────────────────────────────────

export interface Policy {
  registration: "open" | "invite" | "closed";
}

export interface TokenResponse {
  token: string;
  expires_at: number;
}

export interface LoginResponse extends TokenResponse {
  protected_key: string;
}

export const api = {
  policy: () => request<Policy>("/api/auth/policy", { auth: false }),

  register: (username: string, password: string, protectedKey: string, invite?: string) =>
    request<TokenResponse>("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { username, password, protected_key: protectedKey, ...(invite ? { invite } : {}) },
    }),

  login: (username: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { username, password },
    }),

  refresh: () => request<TokenResponse>("/api/auth/refresh", { method: "POST" }),

  putKey: (oldPassword: string, newPassword: string, newProtectedKey: string) =>
    request<void>("/api/auth/key", {
      method: "PUT",
      body: {
        password: oldPassword,
        new_password: newPassword,
        new_protected_key: newProtectedKey,
      },
    }),

  deleteAccount: (password: string) =>
    request<void>("/api/auth/account", { method: "DELETE", body: { password } }),

  // ── sync（API.md §4）——阶段 5（M3）接入 ──
  // syncManifest / syncGet / syncPut / syncDelete

  // ── relay 流式转发归 ai/llmTransport.ts（本文件不碰 relay）──
};
