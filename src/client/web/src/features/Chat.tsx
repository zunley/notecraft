/**
 * AI 悬浮窗（@assistant-ui/react + LocalRuntime）。
 *
 * TODO:
 * - 前端工具循环 + 文件工具卡片 / write-gate 确认弹窗
 * - LlmTransport 走 RelayTransport；无网时提示「离线」
 * - 会话历史经 ai/sessionStore 落 IndexedDB：刷新可恢复上次对话；
 *   服务端零留存、无会话 API（DESIGN.md §3.4 / §6.5）
 */
export function Chat(_props: { onClose?: () => void }) {
  return <div>AI 悬浮窗（骨架）</div>;
}
