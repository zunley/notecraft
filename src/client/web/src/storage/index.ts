/**
 * 平台注入点：按运行环境返回唯一的 StorageAdapter 实例。
 *
 * TODO: Tauri 环境 → TauriFsAdapter；浏览器 → OpfsAdapter。
 * 后续加密阶段在此处包装 CipherAdapter（读时解密、写时加密，协议零改动）。
 */
import type { StorageAdapter } from "./types";

export function createStorage(): StorageAdapter {
  // TODO: 平台探测与实例化
  throw new Error("StorageAdapter 尚未实现（骨架阶段）");
}

export * from "./types";
