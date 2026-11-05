/**
 * TauriFs 适配器（桌面/移动：真实 .md 文件，「文件即真相」）。
 *
 * 阶段 6（M4）实现：@tauri-apps/plugin-fs 读写用户选定的笔记目录。
 * ★ 本文件是业务代码中唯一允许 import @tauri-apps/* 的地方（lint 强制）。
 * ★ 语义与 OpfsAdapter 对齐：本地明文、baseHash 乐观锁、删除进 .trash/。
 */
import type { Entry, StorageAdapter } from "./types";

export class TauriFsAdapter implements StorageAdapter {
  private constructor() {}

  /** 由平台壳注入根目录（阶段 6：目录选择器 + 持久化） */
  static async create(): Promise<TauriFsAdapter> {
    throw new Error("TauriFsAdapter 尚未实现（阶段 6 / M4）");
  }

  async readDir(_path: string): Promise<Entry[]> {
    throw new Error("TauriFsAdapter 尚未实现（阶段 6 / M4）");
  }

  async readFile(_path: string): Promise<{ content: string; hash: string; mtime: number }> {
    throw new Error("TauriFsAdapter 尚未实现（阶段 6 / M4）");
  }

  async writeFile(_path: string, _content: string, _baseHash?: string): Promise<void> {
    throw new Error("TauriFsAdapter 尚未实现（阶段 6 / M4）");
  }

  async rename(_from: string, _to: string): Promise<void> {
    throw new Error("TauriFsAdapter 尚未实现（阶段 6 / M4）");
  }

  async remove(_path: string): Promise<void> {
    throw new Error("TauriFsAdapter 尚未实现（阶段 6 / M4）");
  }

  async stat(_path: string): Promise<Entry | null> {
    throw new Error("TauriFsAdapter 尚未实现（阶段 6 / M4）");
  }
}
