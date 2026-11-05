/**
 * 14 个文件工具定义与工具循环（v1 agent.py 前移客户端，DESIGN-V2 §3.4）。
 *
 * 读工具：list_tree / read_file / search_files / list_backlinks / get_outline
 * 写工具：create_file / write_file / append_file / move_file / delete_file
 *（完整清单以 v1 agent.py 为准移植）
 *
 * TODO:
 * - 工具语义、写授权（会话级确认弹窗 write-gate）、.trash/ 删除、免确认开关沿用 v1
 * - 全部直接执行于本地 StorageAdapter，不经过服务端、离线可用
 * - write-gate 状态保存在当前对话内存中，不持久化、不跨对话
 */
import type { StorageAdapter } from "../storage/types";

// TODO: export const tools: ToolSpec[]（tools 打 storage）
export type ToolExecutor = (storage: StorageAdapter) => void;
