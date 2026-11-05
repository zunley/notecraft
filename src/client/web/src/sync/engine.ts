/**
 * 同步引擎（客户端侧，DESIGN.md §5.2–§5.4）。
 *
 * - 拉：GET manifest → 解密路径 → 与本地 diff → 变化的逐个 GET → 解密 → 写本地；
 * - 推：本地变更经 sync/codec 加密后 PUT（base_hash = 上次同步的密文哈希）；
 * - 冲突（409 / 双方改）：下载服务端版本为新基线，本地内容另存
 *   「名字 (冲突 YYYYMMDD-HHMM).md」后正常推送（DESIGN §5.3，不做自动合并）；
 * - 删除传播：服务端缺失且本地未改 → 本地回收（进 .trash/）；
 *   本地缺失 → DELETE 服务端副本（乐观锁，409 取最新再删）；
 * - 触发：保存防抖 ~2s、回前台/聚焦/visibilitychange、手动「立即同步」；
 * - content/path 编解码只走 sync/codec.ts（加密唯一边界，ARCHITECTURE.md §8 纪律 2）；
 * - ★ 同步基线（密文哈希 + 明文哈希）由本引擎自持并持久化到 localStorage，
 *   state/sync 只存投影——勿与本地明文 base_hash（编辑器乐观锁）混用。
 *
 * 未解锁（keystore 无 MK）或未登录（无 token）时静默跳过：本地编辑不受影响（§3.6）。
 */
import { config } from "../lib/config";
import { api, getToken } from "../lib/api";
import { DomainError, NotFoundError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";
import * as keystore from "../crypto/keystore";
import type { StorageAdapter } from "../storage/types";
import { decodeContent, decodePath, encodeContent, encodePath } from "./codec";

const PUSH_DEBOUNCE_MS = 2000;
const BASELINE_PREFIX = "notecraft.sync.baseline.";

interface BaselineEntry {
  /** 上次与服务端同步的密文哈希（base_hash 用） */
  wire: string;
  /** 对应的本地明文哈希（判断本地是否又改过） */
  plain: string;
}

export interface SyncProjection {
  pending: number;
  syncing: boolean;
  online: boolean;
  rev: number | null;
  lastError: string | null;
}

export interface SyncEngineDeps {
  getStorage(): StorageAdapter | null;
  /** state/sync 投影的唯一写入口（slice 只存投影，ARCHITECTURE.md §3） */
  patch(p: Partial<SyncProjection>): void;
  /** 服务端版本被采纳并覆盖本地文件时（App 决定是否重载编辑器） */
  onFileAdopted?(path: string): void;
}

export class SyncEngine {
  private baseline = new Map<string, BaselineEntry>();
  private dirty = new Set<string>(); // 明文路径：本地有改动待推（pending 计数）
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  private username: string | null = null;

  constructor(private readonly deps: SyncEngineDeps) {
    this.switchUser();
  }

  // ── 触发时机（DESIGN §5.4）────────────────────────────────

  /** 本地有变动（保存/新建/删除/重命名）→ 防抖推送 */
  touch(path?: string): void {
    if (path) this.dirty.add(path);
    this.deps.patch({ pending: this.dirty.size });
    this.schedule(PUSH_DEBOUNCE_MS);
  }

  schedule(ms = PUSH_DEBOUNCE_MS): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  start(): void {
    this.stopped = false;
    window.addEventListener("focus", this.onWake);
    document.addEventListener("visibilitychange", this.onWake);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.deps.patch({ online: navigator.onLine });
    this.schedule(1000); // 启动即对齐一次（未登录/未解锁会静默跳过）
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("focus", this.onWake);
    document.removeEventListener("visibilitychange", this.onWake);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private onWake = () => {
    if (document.visibilityState !== "hidden") void this.syncNow();
  };
  private onOnline = () => this.deps.patch({ online: true });
  private onOffline = () => this.deps.patch({ online: false });

  // ── 主流程 ────────────────────────────────────────────────

  async syncNow(): Promise<void> {
    if (this.running || this.stopped) return;
    const storage = this.deps.getStorage();
    if (!storage) return;
    if (!keystore.isUnlocked() || !getToken()) {
      // 未解锁/未登录：同步不可用但静默降级（本地编辑照常）
      this.deps.patch({ online: navigator.onLine });
      return;
    }
    this.switchUser();

    this.running = true;
    this.deps.patch({ syncing: true, online: navigator.onLine });
    try {
      await this.pull(storage);
      await this.push(storage);
      this.deps.patch({
        pending: this.dirty.size,
        syncing: false,
        online: navigator.onLine,
        lastError: null,
      });
    } catch (e) {
      this.deps.patch({
        syncing: false,
        online: navigator.onLine,
        lastError: e instanceof DomainError ? `${e.code}: ${e.message}` : String((e as Error)?.message ?? e),
      });
    } finally {
      this.saveBaseline();
      this.running = false;
    }
  }

  // ── 拉 ────────────────────────────────────────────────────

  private async pull(storage: StorageAdapter): Promise<void> {
    const manifest = await api.syncManifest();
    if (manifest.protocol > config.syncProtocol) {
      throw new Error("同步协议版本过新，请升级客户端");
    }
    this.deps.patch({ rev: manifest.rev });
    const serverSet = new Set(manifest.files.map((f) => f.path));

    for (const entry of manifest.files) {
      const b = this.baseline.get(entry.path);
      if (b && b.wire === entry.hash) continue; // 服务端与我方一致

      const path = await decodePath(entry.path);
      const local = await this.readOptional(storage, path);
      const localPlain = local ? await sha256Hex(local.content) : null;

      const remote = await api.syncGet(entry.path);
      const remotePlain = await decodeContent(remote.content);
      const remotePlainHash = await sha256Hex(remotePlain);

      if (remotePlainHash === localPlain) {
        // 内容等价（含首次同步两边一致）→ 只对齐基线
        this.baseline.set(entry.path, { wire: remote.hash, plain: remotePlainHash });
        continue;
      }
      if (!local) {
        await storage.writeFile(path, remotePlain);
        this.baseline.set(entry.path, { wire: remote.hash, plain: remotePlainHash });
        this.dirty.delete(path);
        this.deps.onFileAdopted?.(path);
        continue;
      }
      if (b && b.plain === localPlain) {
        // 本地自上次同步未改 → 采纳服务端新版本
        await storage.writeFile(path, remotePlain);
        this.baseline.set(entry.path, { wire: remote.hash, plain: remotePlainHash });
        this.dirty.delete(path);
        this.deps.onFileAdopted?.(path);
        continue;
      }

      // 双方都改了 / 无基线且内容不同 → 冲突：本地另存副本，采纳服务端（DESIGN §5.3）
      const copy = await this.conflictCopy(storage, path, local.content);
      await storage.writeFile(path, remotePlain);
      this.baseline.set(entry.path, { wire: remote.hash, plain: remotePlainHash });
      this.dirty.delete(path);
      if (copy) this.dirty.add(copy);
      this.deps.onFileAdopted?.(path);
      this.schedule(500); // 冲突副本尽快补推
    }

    // 删除传播（服务端已无）：本地未改 → 回收进 .trash/；已改 → 丢基线下轮重建
    for (const [encPath, b] of [...this.baseline]) {
      if (serverSet.has(encPath)) continue;
      const path = await decodePath(encPath);
      const local = await this.readOptional(storage, path);
      if (local && (await sha256Hex(local.content)) === b.plain) {
        await storage.remove(path); // 回收站属笔记本内容、随同步走
        this.dirty.delete(path);
      }
      this.baseline.delete(encPath);
    }
  }

  // ── 推 ────────────────────────────────────────────────────

  private async push(storage: StorageAdapter): Promise<void> {
    const files = await this.walk(storage, "");
    const localEnc = new Set<string>();

    for (const path of files) {
      const content = (await storage.readFile(path)).content;
      const plainHash = await sha256Hex(content);
      const encPath = await encodePath(path);
      localEnc.add(encPath);

      const b = this.baseline.get(encPath);
      if (b && b.plain === plainHash) {
        this.dirty.delete(path); // 本地未变
        continue;
      }

      const wire = await encodeContent(content);
      let put;
      try {
        put = await api.syncPut(encPath, wire, b?.wire ?? "");
      } catch (e) {
        if (e instanceof DomainError && e.code === "conflict") {
          await this.resolveConflict(storage, path, encPath, content, plainHash);
          continue;
        }
        throw e;
      }
      this.baseline.set(encPath, { wire: put.hash, plain: plainHash });
      this.dirty.delete(path);
    }

    // 本地已删除（基线有、本地无）→ 同步删除服务端副本
    for (const [encPath, b] of [...this.baseline]) {
      if (localEnc.has(encPath)) continue;
      try {
        await api.syncDelete(encPath, b.wire);
      } catch (e) {
        if (e instanceof NotFoundError) {
          /* 已被删：幂等 */
        } else if (e instanceof DomainError && e.code === "conflict") {
          // 服务端已被别处更新 → 取最新版本再删（本地删除意图优先，宁可笨而可见）
          try {
            const cur = await api.syncGet(encPath);
            await api.syncDelete(encPath, cur.hash);
          } catch {
            /* 已不存在 */
          }
        } else {
          throw e;
        }
      }
      this.baseline.delete(encPath);
      this.dirty.delete(await decodePath(encPath));
    }
  }

  /** PUT 409：服务端已被别处改（或已删）→ 下载为基线，本地另存冲突副本 */
  private async resolveConflict(
    storage: StorageAdapter,
    path: string,
    encPath: string,
    localContent: string,
    localPlain: string,
  ): Promise<void> {
    let remote;
    try {
      remote = await api.syncGet(encPath);
    } catch (e) {
      if (e instanceof NotFoundError) {
        // 服务端已删 → 本地重建（base_hash 置空）
        const put = await api.syncPut(encPath, await encodeContent(localContent), "");
        this.baseline.set(encPath, { wire: put.hash, plain: localPlain });
        this.dirty.delete(path);
        return;
      }
      throw e;
    }

    const remotePlain = await decodeContent(remote.content);
    const remoteHash = await sha256Hex(remotePlain);
    if (remoteHash === localPlain) {
      this.baseline.set(encPath, { wire: remote.hash, plain: remoteHash });
      return;
    }
    const copy = await this.conflictCopy(storage, path, localContent);
    await storage.writeFile(path, remotePlain); // 服务端版本为新基线
    this.baseline.set(encPath, { wire: remote.hash, plain: remoteHash });
    this.dirty.delete(path);
    if (copy) this.dirty.add(copy);
    this.deps.onFileAdopted?.(path);
    this.schedule(500);
  }

  // ── 工具 ──────────────────────────────────────────────────

  /** 冲突副本：同目录「名字 (冲突 YYYYMMDD-HHMM).md」（已存在则加序号） */
  private async conflictCopy(storage: StorageAdapter, path: string, content: string): Promise<string> {
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash) : "";
    const base = path.slice(slash + 1).replace(/\.md$/, "");
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    const full = (name: string) => (dir ? `${dir}/${name}` : name);
    let name = `${base} (冲突 ${stamp}).md`;
    for (let i = 2; (await storage.stat(full(name))) !== null; i++) {
      name = `${base} (冲突 ${stamp}-${i}).md`;
    }
    const target = full(name);
    await storage.writeFile(target, content);
    return target;
  }

  /** 同步范围：全部 .md（含 .trash/）——目录结构由路径隐含 */
  private async walk(storage: StorageAdapter, dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await storage.readDir(dir);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      if (e.type === "dir") out.push(...(await this.walk(storage, e.path)));
      else if (e.name.endsWith(".md")) out.push(e.path);
    }
    return out;
  }

  private async readOptional(
    storage: StorageAdapter,
    path: string,
  ): Promise<{ content: string } | null> {
    try {
      return await storage.readFile(path);
    } catch {
      return null;
    }
  }

  // ── 基线持久化（localStorage，按账号分桶）───────────────────

  private baselineKey(): string {
    const user = localStorage.getItem("notecraft.username") ?? "anon";
    return BASELINE_PREFIX + user;
  }

  private switchUser(): void {
    const user = localStorage.getItem("notecraft.username");
    if (user === this.username) return;
    if (this.username !== null) this.saveBaseline(); // 换账号：先存旧桶
    this.username = user;
    this.loadBaseline();
  }

  private loadBaseline(): void {
    this.baseline.clear();
    try {
      const raw = localStorage.getItem(this.baselineKey());
      if (raw) {
        for (const [k, v] of JSON.parse(raw) as [string, [string, string]][]) {
          this.baseline.set(k, { wire: v[0], plain: v[1] });
        }
      }
    } catch {
      /* 桶损坏 → 视为首次同步（保守：走冲突流程而非覆盖） */
    }
  }

  private saveBaseline(): void {
    try {
      const dump = [...this.baseline].map(([k, v]) => [k, [v.wire, v.plain]] as [string, [string, string]]);
      localStorage.setItem(this.baselineKey(), JSON.stringify(dump));
    } catch {
      /* 存不下 → 下次全量比对（更慢但正确） */
    }
  }
}
