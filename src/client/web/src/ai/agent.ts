/**
 * 客户端 Agent 运行时（assistant-ui LocalRuntime + 前端工具循环）。
 *
 * ★ Agent 完整在前端运行：服务端 /api/ai/v1/* 只是透明转发 LLM，
 *   不组装 prompt、不执行工具、不持会话状态；工具全部打本地 StorageAdapter。
 *
 * TODO:
 * - 组装完整 messages + tools 数组（+ conversationId）发往 LlmTransport
 * - 工具循环在前端执行：调用 → 结果回填 → 继续，直至模型收口
 * - 会话历史经 ai/sessionStore 落 IndexedDB：刷新/重启恢复上次对话；
 *   服务端零留存，任何会话数据都不会发往服务端存储（DESIGN.md §3.4 / §6.5）
 * - 离线时 chat 给出「离线」提示（仅 LLM 回复与同步需要网络）
 */
import type { LlmTransport } from "./llmTransport";

// TODO: export function createAgentRuntime(transport: LlmTransport, storage: StorageAdapter) {}
export type AgentRuntime = { transport: LlmTransport };
