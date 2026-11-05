/**
 * 客户端配置单点（ARCHITECTURE.md §3 扩展点）：服务端地址、token 存放、Relay 参数、协议版本。
 *
 * ★ 切 DirectTransport 的全部切换量 = 换 transport 实现 + 改本文件 relay 两行（DESIGN.md §6.7）。
 * ★ serverUrl 解析顺序：构建期 env（VITE_SERVER_URL）→ localStorage 覆盖（本地开发/自托管地址）
 *   → 空串 = 同源（服务端托管 Web 版的形态，Docker 单容器即此）。
 *   真实服务器地址属于本地环境，不入库（AGENTS.md 解耦原则）。
 */

const SERVER_URL_KEY = "notecraft.serverUrl";

function detectServerUrl(): string {
  const fromEnv = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    const saved = localStorage.getItem(SERVER_URL_KEY)?.trim();
    if (saved) return saved.replace(/\/+$/, "");
  } catch {
    // 隐私模式等场景：localStorage 不可用，退回同源
  }
  return "";
}

/** 本地覆盖服务端地址（登录页「服务器」输入；空 = 同源） */
export function setServerUrl(url: string): void {
  const cleaned = url.trim().replace(/\/+$/, "");
  try {
    if (cleaned) localStorage.setItem(SERVER_URL_KEY, cleaned);
    else localStorage.removeItem(SERVER_URL_KEY);
  } catch {
    // 存不下不影响运行（仅内存中的值继续生效）
  }
  config.serverUrl = cleaned;
  config.relay.baseUrl = `${cleaned}/api/ai/v1`;
}

export const config = {
  /** 服务端基地址（认证、同步、中继共用；空串 = 同源） */
  serverUrl: detectServerUrl(),
  /** token 的本地存放 key（仅中继与同步需要；token 过期不影响本地编辑） */
  tokenStorageKey: "notecraft.token",
  relay: {
    /** RelayTransport 的 OpenAI 兼容基址：= serverUrl + "/api/ai/v1"（/v1 是 OpenAI 兼容约定） */
    baseUrl: "",
    /** 运行时由 auth 注入 = 用户 token；DirectTransport 期为下发的 LLM key（不落盘） */
    apiKey: "",
    /** 模型名（服务端可用 OPENAI_MODEL 覆盖注入，客户端不感知真实网关） */
    model: "",
  },
  /** 同步协议版本（manifest 的 protocol 字段，见 ARCHITECTURE.md §10） */
  syncProtocol: 1,
};

// 初始化派生值（setServerUrl 可在运行时改写）
config.relay.baseUrl = `${config.serverUrl}/api/ai/v1`;

/** Relay 基址派生（serverUrl 可运行时被 setServerUrl 改写，故用函数取值） */
export function relayBaseUrl(): string {
  return `${config.serverUrl}/api/ai/v1`;
}

/** 拼接服务端绝对地址：`apiUrl("/api/auth/login")` */
export function apiUrl(path: string): string {
  return `${config.serverUrl}${path}`;
}
