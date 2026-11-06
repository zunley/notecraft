/**
 * notes 切片：文件树、当前打开文件、保存状态（DESIGN.md §3.7）。
 *
 * - 全部读写经 StorageAdapter（本地明文真相），无任何服务端调用；
 * - baseHash 是**本地明文**的乐观锁基线——与同步基线（密文哈希，engine 自持）
 *   是两套东西，勿混用（ARCHITECTURE.md §3 同步行）；
 * - 本切片只存状态与本地操作，不 import features（依赖铁律）。
 */
import { create } from "zustand";
import { ConflictError, NotFoundError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";
import type { Entry, StorageAdapter } from "../storage/types";

export type ViewMode = "edit" | "split" | "preview";
export type SaveStatus = "idle" | "loading" | "saving" | "saved" | "conflict";

export interface TreeNode {
  entry: Entry;
  children?: TreeNode[];
}

async function buildTree(storage: StorageAdapter, dir = ""): Promise<TreeNode[]> {
  let entries: Entry[];
  try {
    entries = await storage.readDir(dir);
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // 隐藏目录（.trash/ 等）不进树
    if (e.type === "dir") nodes.push({ entry: e, children: await buildTree(storage, e.path) });
    else if (e.name.endsWith(".md")) nodes.push({ entry: e }); // 只管理 .md
  }
  return nodes;
}

interface NotesState {
  storage: StorageAdapter | null;
  tree: TreeNode[];
  currentPath: string | null;
  /** 已保存的文件内容（编辑器草稿在 Editor 组件内，避免逐键重渲染） */
  currentContent: string;
  /** 本地明文 hash——writeFile 乐观锁基线（非同步基线） */
  baseHash: string | null;
  viewMode: ViewMode;
  status: SaveStatus;
  lastSavedAt: number | null;
  error: string | null;
  /** 内容版本号：open() 自增（AI 覆写当前文件后 Editor 据此重载）；save 不自增 */
  contentVersion: number;
  /** 本地变更钩子（App 注入同步引擎的防抖触发；state 不依赖 sync） */
  onLocalChange?: (path: string) => void;

  init(storage: StorageAdapter): Promise<void>;
  refresh(): Promise<void>;
  open(path: string): Promise<void>;
  close(): void;
  /**
   * 保存草稿。
   * @param opts.force          忽略本地 baseHash 覆盖（冲突时用户主动覆盖）
   * @param opts.expectedPath   草稿所属路径：切换文件后旧草稿兜底落盘用（防串写）
   */
  save(content: string, opts?: { force?: boolean; expectedPath?: string }): Promise<void>;
  createFile(path: string, content?: string): Promise<void>;
  /** 新建文件夹（嵌套路径递归创建）；已存在则报错不覆盖 */
  createDir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  setViewMode(mode: ViewMode): void;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  storage: null,
  tree: [],
  currentPath: null,
  currentContent: "",
  baseHash: null,
  viewMode: "edit",
  status: "idle",
  lastSavedAt: null,
  error: null,
  contentVersion: 0,
  onLocalChange: undefined,

  async init(storage) {
    set({ storage });
    await get().refresh();
  },

  async refresh() {
    const { storage } = get();
    if (!storage) return;
    set({ tree: await buildTree(storage) });
  },

  async open(path) {
    const { storage } = get();
    if (!storage) return;
    set({ status: "loading", error: null });
    try {
      const { content, hash } = await storage.readFile(path);
      set((s) => ({
        currentPath: path,
        currentContent: content,
        baseHash: hash,
        status: "saved",
        contentVersion: s.contentVersion + 1,
      }));
    } catch (e) {
      set({
        status: "idle",
        error: e instanceof NotFoundError ? `文件不存在：${path}` : String((e as Error).message ?? e),
      });
    }
  },

  close() {
    set({ currentPath: null, currentContent: "", baseHash: null, status: "idle", error: null });
  },

  async save(content, opts) {
    const s = get();
    if (!s.storage) return;

    // 旧路径草稿（切换文件后的兜底落盘）：以磁盘最新版本为基线写入，不触碰当前文件状态
    const path = opts?.expectedPath ?? s.currentPath;
    if (!path) return;
    if (path !== s.currentPath) {
      try {
        if (await s.storage.stat(path)) {
          const { hash } = await s.storage.readFile(path);
          await s.storage.writeFile(path, content, hash);
        } else {
          await s.storage.writeFile(path, content);
        }
        get().onLocalChange?.(path);
      } catch {
        /* 磁盘上出现更新内容等极少数情况：放弃兜底写，避免覆盖 */
      }
      return;
    }

    if (!opts?.force && content === s.currentContent) {
      if (s.status !== "conflict") set({ status: "saved" });
      return;
    }
    set({ status: "saving" });
    try {
      await s.storage.writeFile(s.currentPath, content, opts?.force ? undefined : (s.baseHash ?? undefined));
      set({
        currentContent: content,
        baseHash: await sha256Hex(content),
        status: "saved",
        lastSavedAt: Date.now(),
        error: null,
      });
      get().onLocalChange?.(s.currentPath);
    } catch (e) {
      if (e instanceof ConflictError) {
        set({ status: "conflict", error: "本地文件在别处被修改（冲突）" });
      } else {
        set({ status: "idle", error: String((e as Error).message ?? e) });
      }
    }
  },

  async createFile(path, content = "") {
    const s = get();
    if (!s.storage) return;
    if (await s.storage.stat(path)) {
      set({ error: `已存在：${path}` });
      return;
    }
    await s.storage.writeFile(path, content);
    await get().refresh();
    get().onLocalChange?.(path);
    await get().open(path);
  },

  async createDir(path) {
    const s = get();
    if (!s.storage) return;
    if (await s.storage.stat(path)) {
      set({ error: `已存在：${path}` });
      return;
    }
    await s.storage.createDir(path);
    await get().refresh();
  },

  async remove(path) {
    const s = get();
    if (!s.storage) return;
    await s.storage.remove(path);
    if (s.currentPath === path || s.currentPath?.startsWith(`${path}/`)) get().close();
    await get().refresh();
    get().onLocalChange?.(path);
  },

  async rename(from, to) {
    const s = get();
    if (!s.storage) return;
    await s.storage.rename(from, to);
    if (s.currentPath === from) set({ currentPath: to });
    else if (s.currentPath?.startsWith(`${from}/`)) {
      set({ currentPath: `${to}${s.currentPath.slice(from.length)}` });
    }
    await get().refresh();
    get().onLocalChange?.(from);
    get().onLocalChange?.(to);
  },

  setViewMode(mode) {
    set({ viewMode: mode });
  },
}));

/** 树的扁平文件路径列表（wiki 解析、⌘K 用） */
export function flatFiles(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.entry.type === "file") out.push(n.entry.path);
    else if (n.children) out.push(...flatFiles(n.children));
  }
  return out;
}
