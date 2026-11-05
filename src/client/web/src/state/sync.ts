/**
 * sync 切片：同步状态**投影**（DESIGN.md §3.7）。
 *
 * ★ 同步基线（密文哈希 Map）由 sync/engine 自持，不放这里；
 *   本切片只存 pending / syncing / online / rev 等展示态，供 StatusBar 订阅。
 * ★ 明确不做：Redux、事件总线、持久化中间件链。
 */
import { create } from "zustand";

export interface SyncState {
  /** 待同步项数（engine 推算） */
  pending: number;
  syncing: boolean;
  online: boolean;
  /** 服务端该用户 rev（最近一次同步所见） */
  rev: number | null;
  lastError: string | null;

  /** engine → 投影的唯一写入口 */
  patch(partial: Partial<Pick<SyncState, "pending" | "syncing" | "online" | "rev" | "lastError">>): void;
}

export const useSyncStore = create<SyncState>((set) => ({
  pending: 0,
  syncing: false,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  rev: null,
  lastError: null,

  patch(partial) {
    set(partial);
  },
}));
