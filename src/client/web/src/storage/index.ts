/**
 * 平台注入点：按运行环境返回唯一的 StorageAdapter 实例。
 *
 * TODO: Tauri 环境 → TauriFsAdapter；浏览器 → OpfsAdapter。
 * ★ 本层保持明文语义——加密不在 StorageAdapter 外面包装饰器，
 *   而在同步编解码边界（sync/codec.ts，ARCHITECTURE.md §8 纪律 2）。
 */
import type { StorageAdapter } from "./types";

export function createStorage(): StorageAdapter {
  // TODO: 平台探测与实例化
  throw new Error("StorageAdapter 尚未实现（骨架阶段）");
}

export * from "./types";
