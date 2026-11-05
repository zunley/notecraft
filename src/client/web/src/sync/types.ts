/** 同步协议类型（协议细节见 docs/DESIGN.md §5；服务端只见密文，§6.4）。 */

export interface ManifestEntry {
  /** 路径密文——本地树用解密后的路径构建 */
  path: string;
  /** 传输字节（密文）的 sha256 */
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
