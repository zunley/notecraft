/**
 * 存储抽象——本地优先的地基（DESIGN.md §3.2）。
 * 业务模块只依赖此接口，平台差异由实现类消化。
 *
 * ★ 本地永远是明文（文件即真相）：加密只发生在同步编解码边界
 *   （sync/codec → crypto/envelope），不在本层（DESIGN.md §6.4）。
 */

export interface Entry {
  path: string;
  name: string;
  type: "file" | "dir";
  mtime: number;
  size?: number;
}

/** 冲突错误：writeFile 时 base_hash 与当前不符（乐观锁） */
export class ConflictError extends Error {
  constructor(public readonly path: string) {
    super(`conflict: ${path}`);
  }
}

export interface StorageAdapter {
  readDir(path: string): Promise<Entry[]>;
  /** 返回 content 与其内容 hash（sha256）、mtime */
  readFile(path: string): Promise<{ content: string; hash: string; mtime: number }>;
  /** 乐观锁：base_hash 不符抛 ConflictError */
  writeFile(path: string, content: string, baseHash?: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** 移入 .trash/（回收站属笔记本内容、随同步走） */
  remove(path: string): Promise<void>;
  stat(path: string): Promise<Entry | null>;
  /** 可选：桌面端目录变更监听 */
  watch?(cb: () => void): void;
}
