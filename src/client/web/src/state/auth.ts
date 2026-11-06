/**
 * auth 切片：登录态、unlock 态、token（DESIGN.md §3.7；订阅方：Login / StatusBar / 同步与中继）。
 *
 * - token 只是「同步与中继」的通行证——过期/未登录不影响本地编辑（§3.6）；
 * - unlocked = keystore 常驻 MK——同步加解密的前提；两者独立（可离线本地用、未解锁）；
 * - 登录即解锁：派生 L → 服务端校验 → protected_key → KEK 解封 MK（§6.3）；
 * - 登录门（gate）只由用户点击底部「登录 / 解锁」打开——启动永不自动弹出。
 *
 * ★ 依赖方向：state → lib（api/config/errors）+ crypto（keystore）——
 *   features 不直接碰 keystore/密钥材料（依赖铁律）。
 */
import { create } from "zustand";
import * as keystore from "../crypto/keystore";
import { api, clearToken, getToken, setToken } from "../lib/api";
import { DomainError } from "../lib/errors";

export type RegistrationPolicy = "open" | "invite" | "closed";

interface AuthState {
  /** token 是否在本机（决定是否需要走登录拿通行证） */
  hasToken: boolean;
  /** keystore 是否常驻 MK（同步加解密可用） */
  unlocked: boolean;
  /** 登录/解锁门是否显示——只由用户主动点击打开，启动时不自动弹出 */
  gate: boolean;
  username: string | null;
  policy: RegistrationPolicy | null;
  busy: boolean;
  error: string | null;
  /** 注册成功后一次性导出的 REK 内容（下载后置空） */
  pendingRecoveryKey: string | null;

  init(): Promise<void>;
  loadPolicy(): Promise<void>;
  register(username: string, password: string, invite?: string): Promise<boolean>;
  login(username: string, password: string): Promise<boolean>;
  /** 仅本地解锁（凭 REK，无需网络）——同步需另行登录拿 token */
  unlockWithRecovery(content: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<boolean>;
  deleteAccount(password: string): Promise<boolean>;
  logout(): void;
  /** 打开登录/解锁门（仅状态栏「登录 / 解锁」按钮调用） */
  openGate(): void;
  /** 关闭登录门（先离线使用 / 稍后再说）——本地功能永不被阻塞 */
  closeGate(): void;
  clearError(): void;
}

function errMessage(e: unknown): string {
  if (e instanceof DomainError) {
    switch (e.code) {
      case "invalid_credentials":
        return "用户名或口令不正确";
      case "username_taken":
        return "用户名已被占用";
      case "registration_closed":
        return "注册未开放（或邀请码无效）";
      case "rate_limited":
        return `尝试过于频繁，请 ${String(e.details?.retry_after ?? 60)} 秒后再试`;
      case "offline":
        return "网络不可用——可先离线使用，联网后再登录";
      case "auth_expired":
        return "登录已过期，请重新登录";
      default:
        return e.message;
    }
  }
  return String((e as Error)?.message ?? e);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  hasToken: false,
  unlocked: false,
  gate: false,
  username: null,
  policy: null,
  busy: false,
  error: null,
  pendingRecoveryKey: null,

  async init() {
    const hasToken = !!getToken();
    // ★ 登录门永不自动弹出：只有用户点底部「登录 / 解锁」才打开（本地优先铁律）
    set({ hasToken, unlocked: keystore.isUnlocked(), gate: false });
    if (hasToken && !keystore.isUnlocked()) {
      // 刷新后 MK 不在内存——但本地明文照常可用；登录/REK 再解锁即可（§3.6）
      set({ username: localStorage.getItem("notecraft.username") });
    }
    void get().loadPolicy();
  },

  async loadPolicy() {
    try {
      const { registration } = await api.policy();
      set({ policy: registration });
    } catch {
      // 离线/服务端未起：保持 null，登录页按 open 展示（注册请求离线会得到友好错误）
    }
  },

  async register(username, password, invite) {
    set({ busy: true, error: null });
    try {
      const vault = await keystore.createVault(username, password);
      const resp = await api.register(username, vault.loginCredential, vault.protectedKey, invite);
      setToken(resp.token);
      localStorage.setItem("notecraft.username", username);
      set({
        hasToken: true,
        unlocked: true,
        gate: true, // 保持打开：注册后须先展示一次性恢复密钥
        username,
        busy: false,
        pendingRecoveryKey: vault.recoveryKey,
      });
      return true;
    } catch (e) {
      keystore.lock(); // 注册失败不留半开的 vault
      set({ busy: false, error: errMessage(e), unlocked: keystore.isUnlocked() });
      return false;
    }
  },

  async login(username, password) {
    set({ busy: true, error: null });
    try {
      // 先本地派生 L（口令不出客户端），登录拿回信封再解封 MK
      const { loginCredential, kek } = await keystore.deriveLogin(username, password);
      const resp = await api.login(username, loginCredential);
      await keystore.unlockWith(kek, resp.protected_key);
      setToken(resp.token);
      localStorage.setItem("notecraft.username", username);
      set({
        hasToken: true,
        unlocked: true,
        gate: false,
        username,
        busy: false,
        pendingRecoveryKey: null,
      });
      return true;
    } catch (e) {
      set({ busy: false, error: errMessage(e), unlocked: keystore.isUnlocked() });
      return false;
    }
  },

  async unlockWithRecovery(content) {
    set({ busy: true, error: null });
    try {
      const rec = await keystore.recoverFromRecoveryKey(content);
      set({
        unlocked: true,
        busy: false,
        gate: false,
        username: rec.username || get().username,
        // REK 含 L：若在线，尝试直接登录换 token（离线则仅本地解锁）
      });
      if (rec.username && !getToken()) {
        try {
          const resp = await api.login(rec.username, rec.loginCredential);
          setToken(resp.token);
          localStorage.setItem("notecraft.username", rec.username);
          set({ hasToken: true });
        } catch {
          // 离线或凭证已被换掉：本地已解锁，联网后正常登录即可
        }
      }
    } catch (e) {
      set({ busy: false, error: errMessage(e) });
    }
  },

  async changePassword(oldPassword, newPassword) {
    set({ busy: true, error: null });
    try {
      const { loginCredential: oldL } = await keystore.deriveLogin(get().username ?? "", oldPassword);
      const fresh = await keystore.deriveLogin(get().username ?? "", newPassword);
      const newProtectedKey = await keystore.rewrapProtectedKey(fresh.kek);
      await api.putKey(oldL, fresh.loginCredential, newProtectedKey);
      set({ busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: errMessage(e) });
      return false;
    }
  },

  async deleteAccount(password) {
    set({ busy: true, error: null });
    try {
      const { loginCredential } = await keystore.deriveLogin(get().username ?? "", password);
      await api.deleteAccount(loginCredential);
      get().logout();
      set({ busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: errMessage(e) });
      return false;
    }
  },

  logout() {
    clearToken();
    keystore.lock();
    try {
      localStorage.removeItem("notecraft.username");
    } catch {
      /* ignore */
    }
    set({ hasToken: false, unlocked: false, username: null, pendingRecoveryKey: null });
  },

  openGate() {
    set({ gate: true });
  },

  closeGate() {
    set({ gate: false });
  },

  clearError() {
    set({ error: null });
  },
}));
