/**
 * 会话存储——对话历史仅存本机（IndexedDB），零知识的关键一环（DESIGN.md §3.4 / §6.5）。
 *
 * ★ 服务端零留存：不归档、无会话 API；服务端从任何路径都拿不到对话历史。
 * 本模块是会话数据的唯一落点：刷新/重启从这里恢复上次对话。
 *
 * 扩展点（ARCHITECTURE.md §3）：换实现（导出、跨端漫游）只改本文件，调用方零改动。
 */
import type { ChatMessage } from "./llmTransport";

export interface SessionRecord {
  conversationId: string;
  messages: ChatMessage[]; // OpenAI 兼容消息形状（含工具往返）
  updatedAt: number;
}

export interface SessionStore {
  load(conversationId: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
  save(record: SessionRecord): Promise<void>;
  clear(conversationId: string): Promise<void>;
}

const DB_NAME = "notecraft";
const DB_VERSION = 1;
const STORE = "sessions";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "conversationId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 事务失败"));
  });
}

export class IdbSessionStore implements SessionStore {
  private db: Promise<IDBDatabase> | null = null;

  private dbx(): Promise<IDBDatabase> {
    this.db ??= openDb();
    return this.db;
  }

  async load(conversationId: string): Promise<SessionRecord | null> {
    try {
      const db = await this.dbx();
      const rec = await tx<SessionRecord | undefined>(db, "readonly", (s) => s.get(conversationId));
      return rec ?? null;
    } catch {
      return null; // 无 IndexedDB（隐私模式等）：会话不持久但功能不受影响
    }
  }

  async list(): Promise<SessionRecord[]> {
    try {
      const db = await this.dbx();
      const all = await tx<SessionRecord[]>(db, "readonly", (s) => s.getAll());
      return all ?? [];
    } catch {
      return [];
    }
  }

  async save(record: SessionRecord): Promise<void> {
    try {
      const db = await this.dbx();
      await tx(db, "readwrite", (s) => s.put(record));
    } catch {
      /* 存不下不阻塞对话 */
    }
  }

  async clear(conversationId: string): Promise<void> {
    try {
      const db = await this.dbx();
      await tx(db, "readwrite", (s) => s.delete(conversationId));
    } catch {
      /* ignore */
    }
  }
}

/** 会话数据的唯一落点（单例） */
export const sessionStore: SessionStore = new IdbSessionStore();
