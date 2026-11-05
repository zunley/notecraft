/**
 * 同步引擎（客户端侧，DESIGN-V2 §5.2–§5.4）。
 *
 * TODO:
 * - 拉：GET manifest → 与本地 diff → 逐个 GET file 下载
 * - 推：本地变更（base_hash = 上次同步到的版本）→ PUT file → 200 更新 base_hash
 * - 冲突（409）：下载服务端版本为新基线，本地内容另存「冲突副本」后正常推送
 * - 触发：保存防抖 ~2s、回前台/聚焦/visibilitychange、手动「立即同步」
 * - content 编解码走统一函数（当前直通，加密阶段插 CipherAdapter，见 §5.6）
 * - 全程按 token sub 命名空间隔离
 */
import type { Manifest, SyncStatus } from "./types";

// TODO: export class SyncEngine {}
export type SyncEngine = { manifest(): Promise<Manifest>; status(): SyncStatus };
