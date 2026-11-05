/**
 * 客户端 Agent 运行时（assistant-ui LocalRuntime + 前端工具循环）。
 *
 * TODO:
 * - 组装完整 messages + tools 数组（+ conversation_id）发往 LlmTransport
 * - 工具循环在前端执行：调用 → 结果回填 → 继续，直至模型收口
 * - 刷新/重启 = 新对话（D6：客户端无会话历史 UI、不落会话存储）
 * - 离线时 chat 给出「离线」提示（仅 LLM 回复与同步需要网络）
 */
import type { LlmTransport } from "./llmTransport";

// TODO: export function createAgentRuntime(transport: LlmTransport, storage: StorageAdapter) {}
export type AgentRuntime = { transport: LlmTransport };
