/**
 * OPFS 适配器（Web 目标，第六端）。
 *
 * TODO: 基于 Origin Private File System 实现 StorageAdapter，
 * 语义与 TauriFsAdapter 对齐（含 .trash/ 与乐观锁 hash）。
 */
import type { StorageAdapter } from "./types";

// TODO: export class OpfsAdapter implements StorageAdapter {}
export type OpfsAdapter = StorageAdapter;
