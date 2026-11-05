/**
 * 平台注入点：按运行环境返回唯一的 StorageAdapter 实例。
 *
 * ★ 本层保持明文语义——加密不在 StorageAdapter 外面包装饰器，
 *   而在同步编解码边界（sync/codec.ts，ARCHITECTURE.md §8 纪律 2）。
 * ★ 平台差异只经此工厂注入：功能代码零平台判断（UI 零分叉）。
 * ★ @tauri-apps/* 只允许出现在 storage/tauriFs.ts（lint 强制）。
 */
import type { StorageAdapter } from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

/** 异步创建：平台探测可能涉及动态导入（Tauri 实现在阶段 6 接入） */
export async function createStorage(): Promise<StorageAdapter> {
  if (isTauri()) {
    const { TauriFsAdapter } = await import("./tauriFs");
    return TauriFsAdapter.create();
  }
  const { OpfsAdapter } = await import("./opfs");
  return OpfsAdapter.create();
}

export * from "./types";
