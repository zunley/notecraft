/**
 * 状态栏：待同步计数 / 同步中 / 离线指示 + 立即同步 + 账户（DESIGN.md §5.4）。
 *
 * - 订阅 sync 切片（投影）与 auth 切片；同步不可用时静默降级，恢复网络自动补齐；
 * - 账户面板：改口令（只换信封，笔记不动）、注销（验口令，不可恢复）、退出登录。
 */
import { useState } from "react";
import { useAuthStore } from "../state/auth";
import { useSyncStore } from "../state/sync";

export function StatusBar({ onSyncNow }: { onSyncNow?: () => void }) {
  const pending = useSyncStore((s) => s.pending);
  const syncing = useSyncStore((s) => s.syncing);
  const online = useSyncStore((s) => s.online);
  const lastError = useSyncStore((s) => s.lastError);

  const hasToken = useAuthStore((s) => s.hasToken);
  const unlocked = useAuthStore((s) => s.unlocked);
  const username = useAuthStore((s) => s.username);
  const openGate = useAuthStore((s) => s.openGate);

  const [menu, setMenu] = useState(false);

  const dot = !online ? "off" : syncing ? "busy" : "ok";
  let label: string;
  if (!online) label = "离线——本地照常，恢复后自动同步";
  else if (syncing) label = "同步中…";
  else if (lastError) label = `同步异常：${lastError}`;
  else if (pending > 0) label = `待同步 ${pending} 项`;
  else if (!hasToken) label = "未登录（仅本地）";
  else if (!unlocked) label = "未解锁——同步暂不可用";
  else label = "已同步";

  return (
    <footer className="statusbar">
      <span>
        <span className={`dot ${dot}`} /> {label}
      </span>
      <span className="spacer" />
      {hasToken && (
        <button
          onClick={onSyncNow}
          disabled={syncing || !unlocked}
          title={unlocked ? "立即同步" : "先解锁（登录）"}
        >
          {syncing ? "同步中…" : "立即同步"}
        </button>
      )}
      {hasToken && !unlocked && (
        <button onClick={openGate} title="输入口令解锁本机加密（登录即解锁）">
          解锁
        </button>
      )}
      {hasToken ? (
        <button onClick={() => setMenu((v) => !v)}>{username ?? "账户"} ▾</button>
      ) : (
        <button onClick={openGate} title="登录或创建账号，开启跨设备同步与 AI">
          登录
        </button>
      )}
      {menu && <AccountMenu onClose={() => setMenu(false)} />}
    </footer>
  );
}

function AccountMenu({ onClose }: { onClose: () => void }) {
  const username = useAuthStore((s) => s.username);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const changePassword = useAuthStore((s) => s.changePassword);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const logout = useAuthStore((s) => s.logout);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<"idle" | "key" | "delete">("idle");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [delPw, setDelPw] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const submitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await changePassword(oldPw, newPw)) {
      setDone("口令已更新（笔记未动）");
      setMode("idle");
      setOldPw("");
      setNewPw("");
    }
  };

  const submitDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.confirm("注销将删除账号与全部笔记密文，不可恢复。确定？")) return;
    if (await deleteAccount(delPw)) onClose();
  };

  return (
    <div className="account-menu">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{username}</div>
      {done && <div style={{ color: "var(--tx-2)", fontSize: "0.78rem" }}>{done}</div>}
      {error && <div className="err" style={{ color: "var(--danger)", fontSize: "0.78rem" }}>{error}</div>}

      {mode === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <button className="nb-btn" onClick={() => { clearError(); setMode("key"); }}>
            改口令
          </button>
          <button className="nb-btn" onClick={() => { clearError(); setMode("delete"); }}>
            注销账号
          </button>
          <button
            className="nb-btn solid"
            onClick={() => {
              logout();
              onClose();
            }}
          >
            退出登录
          </button>
          <button className="nb-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      )}

      {mode === "key" && (
        <form onSubmit={submitKey} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <input
            type="password"
            placeholder="旧口令"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            placeholder="新口令"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="nb-btn solid" type="submit" disabled={busy || !oldPw || !newPw}>
              {busy ? "…" : "更新"}
            </button>
            <button className="nb-btn" type="button" onClick={() => setMode("idle")}>
              取消
            </button>
          </div>
        </form>
      )}

      {mode === "delete" && (
        <form onSubmit={submitDelete} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div style={{ fontSize: "0.76rem", color: "var(--danger)" }}>
            删除账号与 /notes 下全部密文——请确认已导出恢复密钥。
          </div>
          <input
            type="password"
            placeholder="输入口令确认"
            value={delPw}
            onChange={(e) => setDelPw(e.target.value)}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="nb-btn danger" type="submit" disabled={busy || !delPw}>
              {busy ? "…" : "永久删除"}
            </button>
            <button className="nb-btn" type="button" onClick={() => setMode("idle")}>
              取消
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
