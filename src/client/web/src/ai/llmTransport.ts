/**
 * LLM 接入抽象——二期端到端加密的三条纪律之一（DESIGN-V2 §7）：
 * LLM 调用收敛为单一模块，切换实现只改这里。
 */

export interface ChatRequest {
  /** OpenAI 兼容请求体（客户端每次携带完整 messages 数组，服务端无状态） */
  payload: unknown;
  conversationId: string; // 仅供服务端归档分组，客户端不请求历史
  signal?: AbortSignal;
}

export interface LlmTransport {
  /** 流式返回 OpenAI 兼容增量 */
  stream(req: ChatRequest): AsyncIterable<string>;
}

// TODO: RelayTransport —— POST {server}/api/ai/v1/chat/completions，
//       Bearer = 用户 token，baseURL 与 apiKey 两个参数即可切 DirectTransport
// TODO: DirectTransport（二期预留）—— 直连网关 + 下发 key
