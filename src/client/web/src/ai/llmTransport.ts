/**
 * LLM 接入抽象——扩展点之一（ARCHITECTURE.md §3）：
 * LLM 调用收敛为单一模块，切换实现只改这里（DESIGN.md §6.7 直连网关）。
 *
 * RelayTransport（当前）：POST {server}/api/ai/v1/chat/completions（OpenAI 兼容 SSE），
 * Bearer = 用户 token；服务端注入真实 key 后转发网关、流式回传（零留存）。
 * DirectTransport（演进预留）：直连网关——只换本文件的实现，Agent 位置不变。
 *
 * ★ lib/api.ts 不碰 relay：relay 的流式只在此（ARCHITECTURE.md §8 纪律 1）。
 */
import { getToken } from "../lib/api";
import { relayBaseUrl, config } from "../lib/config";
import { AuthExpiredError, OfflineError, translateHttpError } from "../lib/errors";

// ── OpenAI 兼容消息形状（客户端会话的契约类型）─────────────────

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** 流式增量（OpenAI chunk 的最小形状） */
export interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  /** 仅用于本地 sessionStore 分组；服务端不归档、不持会话状态（零留存） */
  conversationId: string;
  signal?: AbortSignal;
}

export interface LlmTransport {
  /** 流式返回 OpenAI 兼容增量（服务端 4xx/5xx 经 translateHttpError 转领域错误） */
  stream(req: ChatRequest): AsyncGenerator<StreamChunk>;
}

// ── Relay 实现 ────────────────────────────────────────────────

export class RelayTransport implements LlmTransport {
  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk> {
    const token = getToken();
    if (!token) throw new AuthExpiredError("需要登录才能使用 AI");

    const body: Record<string, unknown> = {
      stream: true,
      messages: req.messages,
    };
    if (req.tools?.length) body.tools = req.tools;
    if (config.relay.model) body.model = config.relay.model; // 服务端 OPENAI_MODEL 可覆盖

    let resp: Response;
    try {
      resp = await fetch(`${relayBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch {
      throw new OfflineError();
    }

    if (!resp.ok || !resp.body) {
      const text = await resp.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      throw translateHttpError(resp.status, parsed);
    }

    // SSE 解析：逐行读出 data: 增量（[DONE] 收口）
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data) as StreamChunk;
          } catch {
            /* 忽略不完整的行（下一片段拼上后再解析）——按行缓冲，跳过脏行 */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/** 扩展点：切 DirectTransport 只改这里的返回值（DESIGN.md §6.7） */
export function createTransport(): LlmTransport {
  return new RelayTransport();
}
