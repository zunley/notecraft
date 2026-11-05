/**
 * 文件工具注册表（DESIGN.md §3.4）。
 *
 * 声明式注册表而非硬编码数组：LLM 的 tools 数组、write-gate 挂载、离线执行
 * 全部由注册表驱动——新增工具 = 在 tools 中加一项，不改工具循环。
 *
 * 语义：写工具的会话级授权（write-gate）、.trash/ 删除、免确认开关；
 * 全部直接执行于本地 StorageAdapter，不经过服务端、离线可用。
 */
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

export const tools: ToolSpec[] = [
  // TODO 读工具：list_tree / read_file / search_files / list_backlinks / get_outline
  // TODO 写工具：create_file / write_file / append_file / move_file / delete_file
];
