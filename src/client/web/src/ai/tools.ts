/**
 * 文件工具注册表（DESIGN.md §3.4）。
 *
 * 声明式注册表而非硬编码数组：LLM 的 tools 数组、write-gate 挂载、离线执行
 * 全部由注册表驱动——新增工具 = 在 tools 中加一项，不改工具循环。
 *
 * 语义：写工具的会话级授权（write-gate）、.trash/ 删除、免确认开关；
 * 全部直接执行于本地 StorageAdapter，不经过服务端、离线可用。
 *
 * ★ 依赖铁律：只依赖 StorageAdapter + lib/search——不 import React/state
 *   （树刷新由 features/Chat 在工具执行后统一触发）。
 */
import { extractOutline, listBacklinks, searchFiles } from "../lib/search";
import type { StorageAdapter } from "../storage/types";

export type ToolKind = "read" | "write"; // write 类自动挂 write-gate 会话级确认

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema（OpenAI tools.function.parameters 形状） */
  parameters: Record<string, unknown>;
  kind: ToolKind;
  /** 直接打本地 StorageAdapter */
  execute: (storage: StorageAdapter, args: Record<string, unknown>) => Promise<unknown>;
}

// ── 参数与结果的公共约定 ──────────────────────────────────────

const PATH = { type: "string", description: "笔记路径（相对笔记本根，含 .md）" } as const;

function str(args: Record<string, unknown>, key: string, fallback = ""): string {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}

/** 路径规范化：拒绝绝对路径与 .. 穿越 */
function safePath(raw: string): string {
  const p = raw.trim().replace(/^\/+/, "");
  if (!p || p.split("/").includes("..")) throw new Error(`非法路径: ${raw}`);
  return p;
}

const READ_LIMIT = 16_000; // 读入上下文的单文件上限（字符）

function clip(text: string): string {
  return text.length > READ_LIMIT ? `${text.slice(0, READ_LIMIT)}\n…（已截断，共 ${text.length} 字符）` : text;
}

async function readOrThrow(storage: StorageAdapter, path: string): Promise<string> {
  try {
    return (await storage.readFile(path)).content;
  } catch {
    throw new Error(`文件不存在或不可读: ${path}`);
  }
}

// ── 注册表 ────────────────────────────────────────────────────

export const tools: ToolSpec[] = [
  // ── 读工具（离线可用，不进 write-gate）────────────────────
  {
    name: "list_tree",
    description: "列出笔记本的文件树（全部 .md 笔记与目录），不包含 .trash/ 回收站。",
    parameters: { type: "object", properties: {}, required: [] },
    kind: "read",
    async execute(storage) {
      const walk = async (dir: string, depth: number): Promise<unknown> => {
        if (depth > 8) return [];
        let entries;
        try {
          entries = await storage.readDir(dir);
        } catch {
          return [];
        }
        const out: unknown[] = [];
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          if (e.type === "dir") out.push({ name: e.name, path: e.path, children: await walk(e.path, depth + 1) });
          else if (e.name.endsWith(".md")) out.push({ name: e.name, path: e.path, size: e.size ?? 0 });
        }
        return out;
      };
      return walk("", 0);
    },
  },
  {
    name: "read_file",
    description: "读取一篇笔记的完整内容（Markdown 明文）。",
    parameters: { type: "object", properties: { path: PATH }, required: ["path"] },
    kind: "read",
    async execute(storage, args) {
      const path = safePath(str(args, "path"));
      return { path, content: clip(await readOrThrow(storage, path)) };
    },
  },
  {
    name: "search_files",
    description: "全文搜索笔记（大小写不敏感，按行返回命中）。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "搜索关键词" }, limit: { type: "number" } },
      required: ["query"],
    },
    kind: "read",
    async execute(storage, args) {
      const limit = typeof args.limit === "number" ? Math.min(args.limit, 100) : 50;
      return searchFiles(storage, str(args, "query"), limit);
    },
  },
  {
    name: "list_backlinks",
    description: "列出通过 [[内链]] 指向某篇笔记的所有笔记（反向链接）。",
    parameters: { type: "object", properties: { path: PATH }, required: ["path"] },
    kind: "read",
    async execute(storage, args) {
      const target = safePath(str(args, "path"));
      return { path: target, backlinks: await listBacklinks(storage, target) };
    },
  },
  {
    name: "get_outline",
    description: "提取一篇笔记的标题大纲（# / ## / ### 及行号）。",
    parameters: { type: "object", properties: { path: PATH }, required: ["path"] },
    kind: "read",
    async execute(storage, args) {
      const path = safePath(str(args, "path"));
      return { path, outline: extractOutline(await readOrThrow(storage, path)) };
    },
  },

  // ── 写工具（自动挂 write-gate 会话级确认；删除进 .trash/）──
  {
    name: "create_file",
    description: "新建一篇笔记（父目录自动创建）；已存在则报错。",
    parameters: {
      type: "object",
      properties: { path: PATH, content: { type: "string", description: "初始内容，可省略" } },
      required: ["path"],
    },
    kind: "write",
    async execute(storage, args) {
      const path = safePath(str(args, "path"));
      if (await storage.stat(path)) throw new Error(`已存在: ${path}`);
      await storage.writeFile(path, str(args, "content", ""));
      return { created: path };
    },
  },
  {
    name: "write_file",
    description: "整篇覆盖写入一篇笔记（不传 baseHash——以最新磁盘版本为准）。",
    parameters: {
      type: "object",
      properties: { path: PATH, content: { type: "string", description: "完整 Markdown 内容" } },
      required: ["path", "content"],
    },
    kind: "write",
    async execute(storage, args) {
      const path = safePath(str(args, "path"));
      await storage.writeFile(path, str(args, "content"));
      return { written: path, bytes: str(args, "content").length };
    },
  },
  {
    name: "append_file",
    description: "向一篇笔记末尾追加内容（文件不存在则创建）。",
    parameters: {
      type: "object",
      properties: { path: PATH, content: { type: "string", description: "追加的 Markdown 内容" } },
      required: ["path", "content"],
    },
    kind: "write",
    async execute(storage, args) {
      const path = safePath(str(args, "path"));
      const addition = str(args, "content");
      let existing = "";
      try {
        existing = (await storage.readFile(path)).content;
      } catch {
        /* 新文件 */
      }
      const next = existing ? `${existing.replace(/\s*$/, "")}\n\n${addition}` : addition;
      await storage.writeFile(path, next);
      return { appended: path };
    },
  },
  {
    name: "move_file",
    description: "移动/重命名一篇笔记（目录自动创建）。",
    parameters: {
      type: "object",
      properties: { from: PATH, to: { ...PATH, description: "目标路径（含 .md）" } },
      required: ["from", "to"],
    },
    kind: "write",
    async execute(storage, args) {
      const from = safePath(str(args, "from"));
      const to = safePath(str(args, "to"));
      if (!(await storage.stat(from))) throw new Error(`源文件不存在: ${from}`);
      await storage.rename(from, to);
      return { moved: { from, to } };
    },
  },
  {
    name: "delete_file",
    description: "删除一篇笔记（移入 .trash/ 回收站，可恢复，随同步走）。",
    parameters: { type: "object", properties: { path: PATH }, required: ["path"] },
    kind: "write",
    async execute(storage, args) {
      const path = safePath(str(args, "path"));
      if (!(await storage.stat(path))) throw new Error(`文件不存在: ${path}`);
      await storage.remove(path);
      return { trashed: path };
    },
  },
];

/** 写工具集合（write-gate 判定用） */
export const writeToolNames = new Set(tools.filter((t) => t.kind === "write").map((t) => t.name));

/** 工具清单 → OpenAI tools 数组 */
export function toToolDefs(): { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** 按名字取工具（找不到返回 undefined——由循环回给模型） */
export function findTool(name: string): ToolSpec | undefined {
  return tools.find((t) => t.name === name);
}
