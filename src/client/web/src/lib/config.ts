/**
 * 客户端配置单点：server 地址、token 存放、Relay 参数、协议版本。
 *
 * TODO: 从运行环境加载（Tauri 配置 / Web localStorage / 构建期 env）。
 * 二期 DirectTransport 的全部切换量 = 换 transport 与 relay 两个参数（DESIGN-V2 §7）。
 */
export const config = {
  /** 服务端基地址（认证、同步、中继共用） */
  serverUrl: "",
  /** token 的本地存放 key（仅中继与同步需要；token 过期不影响本地编辑） */
  tokenStorageKey: "notecraft.token",
  relay: {
    /** RelayTransport：= serverUrl + "/api/ai/v1" */
    baseUrl: "",
    /** = 用户 token；DirectTransport 期为下发的 LLM key（不落盘） */
    apiKey: "",
    model: "",
  },
  /** 同步协议版本（manifest 的 protocol 字段，见 ARCHITECTURE.md §10） */
  syncProtocol: 1,
} as const;
