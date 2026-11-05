/**
 * LLM 接入抽象——扩展点之一（ARCHITECTURE.md §3）：
 * LLM 调用收敛为单一模块，切换实现只改这里（DESIGN.md §6.7 直连网关）。
 */

export interface ChatRequest {
  /** OpenAI 兼容请求体（客户端每次携带完整 messages 数组，服务端无状态） */
  payload: unknown;
  /** 仅用于本地 sessionStore 分组；服务端不归档、不持会话状态（零留存） */
  conversationId: string;
  signal?: AbortSignal;
}

export interface LlmTransport {
  /** 流式返回 OpenAI 兼容增量 */
  stream(req: ChatRequest): AsyncIterable<string>;
}

// TODO: RelayTransport —— POST {server}/api/ai/v1/chat/completions，
//       Bearer = 用户 token，baseURL 与 apiKey 两个参数即可切 DirectTransport
// TODO: DirectTransport（演进预留，DESIGN.md §6.7）—— 直连网关 + 下发 key
