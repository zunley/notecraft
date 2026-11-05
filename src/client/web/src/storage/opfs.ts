/**
 * OPFS 适配器（Web 目标，第六端）——StorageAdapter 的浏览器实现。
 *
 * 语义与 TauriFsAdapter 对齐（阶段 6）：
 * - 本地永远是明文（文件即真相），hash = 明文 utf-8 字节的 sha256；
 * - 乐观锁：writeFile 带 baseHash 时先比对当前 hash，不符抛 ConflictError；
 * - 删除一律先移入 .trash/（回收站属笔记本内容、随同步走，DESIGN.md §3.1）；
 *   已在 .trash/ 内的删除才是真删。
 *
 * 平台差异全部消化在本文件——功能代码零平台判断（ARCHITECTURE.md §3）。
 */
import { sha256Hex } from "../lib/hash";
import { ConflictError, NotFoundError } from "../lib/errors";
import type { Entry, StorageAdapter } from "./types";

const TRASH = ".trash";

/** TS DOM 类型未包含目录异步迭代器（MDN: values()），本地声明 */
interface IterableDir extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

function parts(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export class OpfsAdapter implements StorageAdapter {
  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  static async create(): Promise<OpfsAdapter> {
    const root = await navigator.storage.getDirectory();
    return new OpfsAdapter(root);
  }

  // ── 句柄导航 ────────────────────────────────────────────────

  private async dirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let cur = this.root;
    for (const part of parts(path)) cur = await cur.getDirectoryHandle(part, { create });
    return cur;
  }

  private async fileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const segs = parts(path);
    if (segs.length === 0) throw new NotFoundError(`not a file: ${path}`);
    const name = segs.pop()!;
    const parent = await this.dirHandle(segs.join("/"), create);
    return parent.getFileHandle(name, { create });
  }

  private async exists(path: string): Promise<boolean> {
    const segs = parts(path);
    if (segs.length === 0) return true;
    const name = segs.pop()!;
    try {
      const parent = await this.dirHandle(segs.join("/"), false);
      await parent.getFileHandle(name);
      return true;
    } catch {
      try {
        const parent = await this.dirHandle(segs.join("/"), false);
        await parent.getDirectoryHandle(name);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ── StorageAdapter ──────────────────────────────────────────

  async readDir(path: string): Promise<Entry[]> {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.dirHandle(path, false);
    } catch {
      throw new NotFoundError(`dir not found: ${path}`);
    }
    const out: Entry[] = [];
    for await (const handle of (dir as IterableDir).values()) {
      const childPath = path ? `${path}/${handle.name}` : handle.name;
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ path: childPath, name: handle.name, type: "file", mtime: file.lastModified, size: file.size });
      } else {
        out.push({ path: childPath, name: handle.name, type: "dir", mtime: 0 });
      }
    }
    return out.sort((a, b) =>
      a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  async readFile(path: string): Promise<{ content: string; hash: string; mtime: number }> {
    let file: File;
    try {
      file = await (await this.fileHandle(path, false)).getFile();
    } catch {
      throw new NotFoundError(`file not found: ${path}`);
    }
    const content = await file.text();
    return { content, hash: await sha256Hex(content), mtime: file.lastModified };
  }

  async writeFile(path: string, content: string, baseHash?: string): Promise<void> {
    if (baseHash !== undefined && baseHash !== "") {
      const exists = await this.exists(path);
      if (!exists) throw new ConflictError(path); // 基线存在但文件已消失（别处删除）
      const { hash } = await this.readFile(path);
      if (hash !== baseHash) throw new ConflictError(path);
    }
    const handle = await this.fileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async rename(from: string, to: string): Promise<void> {
    const segs = parts(from);
    if (segs.length === 0) throw new NotFoundError(`rename: ${from}`);
    // 目录：递归搬移
    try {
      await this.dirHandle(from, false);
      await this.copyTree(from, to);
      await this.deleteRaw(from);
      return;
    } catch {
      /* 不是目录，走文件分支 */
    }
    const { content } = await this.readFile(from);
    await this.writeFile(to, content);
    await this.deleteRaw(from);
  }

  async remove(path: string): Promise<void> {
    if (parts(path)[0] === TRASH) {
      await this.deleteRaw(path); // 回收站内再删 = 真删
      return;
    }
    const target = `${TRASH}/${path}`;
    try {
      await this.dirHandle(path, false);
      await this.copyTree(path, target); // 目录整体进回收站
    } catch {
      const { content } = await this.readFile(path);
      await this.writeFile(target, content);
    }
    await this.deleteRaw(path);
  }

  async stat(path: string): Promise<Entry | null> {
    if (!(await this.exists(path))) return null;
    const segs = parts(path);
    const name = segs[segs.length - 1];
    try {
      const file = await (await this.fileHandle(path, false)).getFile();
      return { path, name, type: "file", mtime: file.lastModified, size: file.size };
    } catch {
      return { path, name, type: "dir", mtime: 0 };
    }
  }

  // watch?——OPFS 无原生目录监听（可选项，Web 端不实现）

  // ── 内部工具 ────────────────────────────────────────────────

  private async copyTree(from: string, to: string): Promise<void> {
    const src = (await this.dirHandle(from, false)) as IterableDir;
    await this.dirHandle(to, true);
    for await (const handle of src.values()) {
      const childFrom = `${from}/${handle.name}`;
      const childTo = `${to}/${handle.name}`;
      if (handle.kind === "file") {
        const text = await (handle as FileSystemFileHandle).getFile().then((f) => f.text());
        const out = await this.fileHandle(childTo, true);
        const w = await out.createWritable();
        await w.write(text);
        await w.close();
      } else {
        await this.copyTree(childFrom, childTo);
      }
    }
  }

  private async deleteRaw(path: string): Promise<void> {
    const segs = parts(path);
    const name = segs.pop();
    if (!name) return;
    const parent = await this.dirHandle(segs.join("/"), false);
    try {
      await parent.removeEntry(name, { recursive: true });
    } catch {
      /* 已不存在：幂等 */
    }
  }
}
