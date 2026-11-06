/**
 * TauriFs 适配器（桌面/移动：真实 .md 文件，「文件即真相」）。
 *
 * - 首次启动经目录选择器（dialog 插件）选定笔记根目录，持久化在 localStorage
 *   （笔记目录是环境信息，只存本地不入库——AGENTS.md 解耦原则）；
 * - 语义与 OpfsAdapter 对齐：本地明文、baseHash 乐观锁、删除进 .trash/；
 * - ★ 本文件是业务代码中唯一允许 import @tauri-apps/* 的地方（lint 强制）；
 * - 能力范围：capabilities/default.json 的 fs:scope 限定在 $HOME/**（沙箱内读写笔记目录）。
 */
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  stat,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { ConflictError, NotFoundError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";
import type { Entry, StorageAdapter } from "./types";

const BASE_KEY = "notecraft.noteDir";
const TRASH = ".trash";

export class TauriFsAdapter implements StorageAdapter {
  private constructor(private readonly base: string) {}

  /** 平台壳注入根目录：已选过则复用，否则弹目录选择器（用户可换：清 localStorage 重选） */
  static async create(): Promise<TauriFsAdapter> {
    let base = "";
    try {
      base = localStorage.getItem(BASE_KEY) ?? "";
    } catch {
      /* 隐私模式等 */
    }
    if (!base) {
      const chosen = await openDialog({
        directory: true,
        multiple: false,
        title: "选择笔记目录（本地 Markdown 文件夹）",
      });
      if (typeof chosen !== "string" || !chosen) {
        throw new Error("未选择笔记目录——重启应用后可重新选择");
      }
      base = chosen.replace(/[\\/]+$/, "");
      try {
        localStorage.setItem(BASE_KEY, base);
      } catch {
        /* 存不下则下次再选 */
      }
    }
    return new TauriFsAdapter(base);
  }

  // ── 路径 ──────────────────────────────────────────────────

  /** 相对路径 → 绝对路径（拒绝 .. 穿越；插件侧另有 scope 兜底） */
  private abs(path: string): string {
    const segs = path.split("/").filter(Boolean);
    if (segs.some((s) => s === "..")) throw new Error(`非法路径: ${path}`);
    return segs.length ? `${this.base}/${segs.join("/")}` : this.base;
  }

  private async ensureParent(absPath: string): Promise<void> {
    const idx = absPath.lastIndexOf("/");
    if (idx > this.base.length) {
      await mkdir(absPath.slice(0, idx), { recursive: true });
    }
  }

  // ── StorageAdapter ──────────────────────────────────────────

  async readDir(path: string): Promise<Entry[]> {
    const abs = this.abs(path);
    if (!(await exists(abs))) throw new NotFoundError(`dir not found: ${path}`);
    const entries = await readDir(abs);
    const out: Entry[] = entries.map((e) => ({
      path: path ? `${path}/${e.name}` : e.name,
      name: e.name,
      type: e.isDirectory ? ("dir" as const) : ("file" as const),
      mtime: 0, // 列表不展示 mtime；readFile 才取（避免逐项 stat）
    }));
    return out.sort((a, b) =>
      a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  async readFile(path: string): Promise<{ content: string; hash: string; mtime: number }> {
    const abs = this.abs(path);
    if (!(await exists(abs))) throw new NotFoundError(`file not found: ${path}`);
    const bytes = await readFile(abs);
    const content = new TextDecoder().decode(bytes);
    const info = await stat(abs);
    return { content, hash: await sha256Hex(content), mtime: info.mtime?.getTime() ?? 0 };
  }

  async writeFile(path: string, content: string, baseHash?: string): Promise<void> {
    const abs = this.abs(path);
    if (baseHash !== undefined && baseHash !== "") {
      if (!(await exists(abs))) throw new ConflictError(path); // 基线存在但文件已消失
      const { hash } = await this.readFile(path);
      if (hash !== baseHash) throw new ConflictError(path);
    }
    await this.ensureParent(abs);
    await writeFile(abs, new TextEncoder().encode(content));
  }

  async createDir(path: string): Promise<void> {
    await mkdir(this.abs(path), { recursive: true }); // 递归创建（已存在即幂等）
  }

  async rename(from: string, to: string): Promise<void> {
    const a = this.abs(from);
    const b = this.abs(to);
    if (!(await exists(a))) throw new NotFoundError(`rename: ${from}`);
    if (await exists(b)) await remove(b, { recursive: true }); // 与 OPFS 语义一致：覆盖
    await this.ensureParent(b);
    await rename(a, b);
  }

  async remove(path: string): Promise<void> {
    const abs = this.abs(path);
    if (!(await exists(abs))) return; // 幂等
    const segs = path.split("/").filter(Boolean);
    if (segs[0] === TRASH) {
      await remove(abs, { recursive: true }); // 回收站内再删 = 真删
      return;
    }
    const target = this.abs(`${TRASH}/${path}`);
    if (await exists(target)) await remove(target, { recursive: true }); // 覆盖旧副本
    await this.ensureParent(target);
    await rename(abs, target);
  }

  async stat(path: string): Promise<Entry | null> {
    const abs = this.abs(path);
    if (!(await exists(abs))) return null;
    const info = await stat(abs);
    const segs = path.split("/").filter(Boolean);
    return {
      path,
      name: segs[segs.length - 1] ?? path,
      type: info.isDirectory ? "dir" : "file",
      mtime: info.mtime?.getTime() ?? 0,
      size: info.size,
    };
  }

  // watch?——目录监听随 tauri-plugin-fs watch 后续接入（可选项，桌面端增强）
}
