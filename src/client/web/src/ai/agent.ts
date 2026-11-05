/**
 * 客户端 Agent 运行时（前端工具循环；接缝兼容 assistant-ui LocalRuntime 的
 * ChatModelAdapter 形态——后续换入只改适配层，本文件逻辑不变）。
 *
 * ★ Agent 完整在前端运行：服务端 /api/ai/v1/* 只是透明转发 LLM，
 *   不组装 prompt、不执行工具、不持会话状态；工具全部打本地 StorageAdapter。
 * - 每轮携带完整 messages + tools（服务端无状态）；
 * - 工具循环在前端执行：调用 → 结果回填 → 继续，直至模型收口（上限 MAX_STEPS）；
 * - write-gate：写工具执行前经 onGate 征求确认（会话级授权由 UI 实现）；
 * - 会话历史经 ai/sessionStore 落 IndexedDB：刷新/重启恢复上次对话；
 *   服务端零留存，任何会话数据都不会发往服务端存储（DESIGN.md §3.4 / §6.5）。
 */
import type { StorageAdapter } from "../storage/types";
import type { ChatMessage, LlmTransport } from "./llmTransport";
import { findTool, toToolDefs } from "./tools";

export const SYSTEM_PROMPT = `你是 notecraft——一个运行在用户本地 Markdown 笔记本里的 AI 助手。

原则：
- 笔记就是磁盘上的纯 .md 文件（明文），你通过工具直接读写本地文件，全部离线可执行；
- 回答简洁、直接，用用户的语言（默认中文）；
- 找笔记先 list_tree / search_files，不要凭空编造路径；
- 整理、归档、批量修改用写工具完成，写入会经用户授权确认；
- 内链用 [[目标]] 语法，删除的文件会进 .trash/ 回收站。`;

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: unknown; ok: boolean }
  /** 本轮完整消息（含工具往返）——调用方据此持久化会话 */
  | { type: "done"; messages: ChatMessage[] }
  | { type: "error"; error: string };

export interface GateRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentDeps {
  transport: LlmTransport;
  storage: StorageAdapter;
  conversationId: string;
  systemPrompt?: string;
  /** write-gate：写工具执行前征求确认（UI 提供；恒 true = 本会话免确认） */
  onGate?: (req: GateRequest) => Promise<boolean>;
  signal?: AbortSignal;
}

/** 工具循环上限（防失控；达到即收口） */
const MAX_STEPS = 12;

interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function errorMessage(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

/**
 * 执行一轮对话（异步生成器，流式产出事件）。
 * @param history 之前的消息（不含 system；可为空）
 * @param userText 本轮用户输入
 */
export async function* runAgentTurn(
  deps: AgentDeps,
  history: ChatMessage[],
  userText: string,
): AsyncGenerator<AgentEvent> {
  const messages: ChatMessage[] = [
    { role: "system", content: deps.systemPrompt ?? SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      let text = "";
      const pending = new Map<number, PendingToolCall>();

      for await (const chunk of deps.transport.stream({
        messages,
        tools: toToolDefs(),
        conversationId: deps.conversationId,
        signal: deps.signal,
      })) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          yield { type: "text", text: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const cur = pending.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          pending.set(tc.index, cur);
        }
      }

      // 无工具调用 → 模型收口
      if (pending.size === 0) {
        messages.push({ role: "assistant", content: text });
        yield { type: "done", messages };
        return;
      }

      // 有工具调用 → 回填执行结果，进入下一轮
      const toolCalls = [...pending.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v], i) => ({
          id: v.id || `call_${step}_${i}`,
          type: "function" as const,
          function: { name: v.name, arguments: v.args || "{}" },
        }));
      messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });

      for (const call of toolCalls) {
        const spec = findTool(call.function.name);
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(call.function.arguments || "{}");
          if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
        } catch {
          /* 参数解析失败→按空参执行，由工具报错回给模型 */
        }

        if (!spec) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `未知工具: ${call.function.name}` }),
          });
          continue;
        }

        yield { type: "tool_start", name: spec.name, args };

        // write-gate：写工具必须过会话级授权（read 工具离线直行）
        if (spec.kind === "write" && deps.onGate) {
          const approved = await deps.onGate({ name: spec.name, args });
          if (!approved) {
            const denied = { error: "用户拒绝了本次写入授权" };
            yield { type: "tool_end", name: spec.name, result: denied, ok: false };
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(denied) });
            continue;
          }
        }

        try {
          const result = await spec.execute(deps.storage, args);
          yield { type: "tool_end", name: spec.name, result, ok: true };
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        } catch (e) {
          const result = { error: errorMessage(e) };
          yield { type: "tool_end", name: spec.name, result, ok: false };
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
    }

    yield { type: "error", error: `达到工具循环上限（${MAX_STEPS} 轮），已中止` };
    yield { type: "done", messages };
  } catch (e) {
    yield { type: "error", error: errorMessage(e) };
    yield { type: "done", messages };
  }
}
