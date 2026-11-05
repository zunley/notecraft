/**
 * 同步引擎（客户端侧，DESIGN.md §5.2–§5.4）。
 *
 * TODO:
 * - 拉：GET manifest → 解密路径 → 与本地 diff → 逐个 GET file → 解密 → 写本地
 * - 推：本地变更经 sync/codec 加密后 PUT file（base_hash = 上次同步的密文哈希）
 * - 冲突（409）：下载服务端版本为新基线，本地内容另存「冲突副本」后正常推送
 * - 触发：保存防抖 ~2s、回前台/聚焦/visibilitychange、手动「立即同步」
 * - content/path 编解码只走 sync/codec.ts（加密唯一边界，ARCHITECTURE.md §8 纪律 2）
 * - 全程按 token sub 命名空间隔离
 */
import type { Manifest, SyncStatus } from "./types";

// TODO: export class SyncEngine {}
export type SyncEngine = { manifest(): Promise<Manifest>; status(): SyncStatus };
