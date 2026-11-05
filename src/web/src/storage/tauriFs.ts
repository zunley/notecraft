/**
 * Tauri 文件系统适配器（桌面 + 移动）。
 *
 * TODO: 基于 @tauri-apps/plugin-fs 实现 StorageAdapter：
 * - 桌面：用户通过目录选择器选定的笔记目录（文件即真相）
 * - 移动：App 沙箱目录（iOS Documents，可经「文件」App 访问）
 * - 实现 watch()（桌面端目录变更监听）
 */
import type { StorageAdapter } from "./types";

// TODO: export class TauriFsAdapter implements StorageAdapter {}
export type TauriFsAdapter = StorageAdapter;
