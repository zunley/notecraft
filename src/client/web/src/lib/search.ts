/**
 * 全文搜索 / 内链索引——**唯一实现**（DESIGN.md §3.3）。
 *
 * ⌘K 面板与 AI 工具 search_files / list_backlinks / get_outline 共用本文件，
 * 禁止两处各写一份（ARCHITECTURE.md §3 搜索单源）。
 * 目录规模小，内存遍历即可，不做索引。
 */
import type { StorageAdapter } from "../storage/types";

export interface SearchHit {
  path: string;
  /** 1 起的行号 */
  line: number;
  /** 该行原文（截断到 200 字符） */
  text: string;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

/** 递归收集全部笔记文件（跳过 . 开头的隐藏目录，含 .trash/） */
export async function walkFiles(storage: StorageAdapter, dir = ""): Promise<string[]> {
  let entries;
  try {
    entries = await storage.readDir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.type === "dir") out.push(...(await walkFiles(storage, entry.path)));
    else if (entry.name.endsWith(".md")) out.push(entry.path);
  }
  return out;
}

/** 全文搜索：大小写不敏感的子串匹配，按行返回（limit 限命中数） */
export async function searchFiles(
  storage: StorageAdapter,
  query: string,
  limit = 50,
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const files = await walkFiles(storage);
  const hits: SearchHit[] = [];
  for (const path of files) {
    let content: string;
    try {
      content = (await storage.readFile(path)).content;
    } catch {
      continue; // 读取期间被删除/移动
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push({ path, line: i + 1, text: lines[i].trim().slice(0, 200) });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

/** 提取 wiki 内链目标：[[目标]] / [[目标|显示名]]（去重、保持出现顺序） */
export function extractWikiLinks(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const target = m[1].trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

/** 反链：所有链接到 targetPath 的笔记路径 */
export async function listBacklinks(storage: StorageAdapter, targetPath: string): Promise<string[]> {
  const files = await walkFiles(storage);
  const out: string[] = [];
  for (const path of files) {
    if (path === targetPath) continue;
    const { content } = await storage.readFile(path);
    for (const target of extractWikiLinks(content)) {
      if (resolveWikiPath(files, target, path) === targetPath) {
        out.push(path);
        break;
      }
    }
  }
  return out;
}

/** 标题大纲：# / ## / ### 行（跳过代码块） */
export function extractOutline(content: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  let inFence = false;
  content.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  return out;
}

/** wiki 目标 → 实际路径：精确 / 同目录 / basename 匹配（含或不含 .md） */
export function resolveWikiPath(files: string[], target: string, fromPath: string): string | null {
  const t = target.trim().replace(/^\/+/, "");
  if (!t) return null;
  const withMd = t.endsWith(".md") ? t : `${t}.md`;
  const dirOf = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const candidates = dirOf ? [`${dirOf}/${withMd}`, withMd] : [withMd, t];
  for (const c of candidates) if (files.includes(c)) return c;
  const base = withMd.slice(withMd.lastIndexOf("/") + 1);
  return files.find((f) => f.slice(f.lastIndexOf("/") + 1) === base) ?? null;
}
