/**
 * 平台注入点：按运行环境返回唯一的 StorageAdapter 实例。
 *
 * TODO: Tauri 环境 → TauriFsAdapter；浏览器 → OpfsAdapter。
 * 组合点（加密纪律③）：返回值是唯一包装位——二期 CipherAdapter 以装饰器包在
 * 外层（读时解密、写时加密），业务层与协议零改动。
 */
import type { StorageAdapter } from "./types";

export function createStorage(): StorageAdapter {
  // TODO: 平台探测与实例化
  throw new Error("StorageAdapter 尚未实现（骨架阶段）");
}

export * from "./types";
