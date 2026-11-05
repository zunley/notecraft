/** 同步协议类型（协议 v1，见 docs/DESIGN-V2.md §5）。 */

export interface ManifestEntry {
  path: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface Manifest {
  rev: number;
  files: ManifestEntry[];
}

/** 本地待同步状态 */
export interface SyncStatus {
  pending: number; // 待同步项数
  syncing: boolean;
  online: boolean;
}
