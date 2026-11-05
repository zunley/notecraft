/**
 * 会话存储——对话历史仅存本机（IndexedDB），零知识的关键一环（DESIGN.md §3.4 / §6.5）。
 *
 * ★ 服务端零留存：不归档、无会话 API；服务端从任何路径都拿不到对话历史。
 * 本模块是会话数据的唯一落点：刷新/重启从这里恢复上次对话。
 *
 * 扩展点（ARCHITECTURE.md §3）：换实现（导出、跨端漫游）只改本文件，调用方零改动。
 */

export interface SessionRecord {
  conversationId: string;
  messages: unknown[]; // OpenAI 兼容消息形状，按需收紧
  updatedAt: number;
}

export interface SessionStore {
  load(conversationId: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
  save(record: SessionRecord): Promise<void>;
  clear(conversationId: string): Promise<void>;
}

// TODO: export class IdbSessionStore implements SessionStore {}
