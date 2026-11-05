/**
 * 登录页 / 解锁门：username + password → 登录即解锁（DESIGN.md §6.3）。
 *
 * - 用户只输入一次口令：本地派生 L + KEK（口令不出客户端），登录拿回 protected_key
 *   解封 MK——加密对用户无感；
 * - 无账号可创建（策略 GET /api/auth/policy）；注册即登录 + 一次性导出 REK 恢复密钥；
 * - 已有 token 但 MK 不在内存（刷新后）→ 本页作「解锁门」；可用 REK 离线解锁；
 * - 「先离线使用」= 关闭登录门（guest）——本地功能永不被阻塞（本地优先铁律）。
 */
import { useEffect, useRef, useState } from "react";
import { setServerUrl, config } from "../lib/config";
import { useAuthStore } from "../state/auth";

type Mode = "login" | "register";

function downloadRecovery(content: string, username: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `notecraft-recovery-${username || "user"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Login() {
  const hasToken = useAuthStore((s) => s.hasToken);
  const policy = useAuthStore((s) => s.policy);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const pendingRecoveryKey = useAuthStore((s) => s.pendingRecoveryKey);
  const username0 = useAuthStore((s) => s.username);
  const register = useAuthStore((s) => s.register);
  const login = useAuthStore((s) => s.login);
  const unlockWithRecovery = useAuthStore((s) => s.unlockWithRecovery);
  const dismissGuest = useAuthStore((s) => s.dismissGuest);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState(username0 ?? "");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [server, setServer] = useState(config.serverUrl);
  const rekInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (error) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── 注册成功：REK 一次性导出（必须先保存，忘记口令时的逃生舱）────
  if (pendingRecoveryKey) {
    return (
      <div className="login-gate">
        <div className="login-screen">
          <div className="login-card">
            <h1>
              保存<em>恢复密钥</em>
            </h1>
            <div className="sub">
              这是忘记口令时打开笔记的<b>唯一方式</b>（服务端零知识，无法找回）。
              请下载并离线保存到安全位置。
            </div>
            <div className="rek-note">
              <b>notecraft-recovery-{username || "user"}.json</b>
              <br />
              凭它可以：本地解锁笔记 / 联网后重设口令。
            </div>
            <div className="actions">
              <button
                className="nb-btn solid"
                onClick={() => downloadRecovery(pendingRecoveryKey, username)}
              >
                ⬇ 下载恢复密钥
              </button>
              <button className="nb-btn" onClick={() => useAuthStore.setState({ pendingRecoveryKey: null })}>
                我已保存，继续
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const canRegister = policy === null || policy === "open" || policy === "invite";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    if (mode === "register" && canRegister) {
      await register(username, password, invite || undefined);
    } else {
      await login(username, password);
    }
  };

  const onRekFile = async (file: File | undefined) => {
    if (!file) return;
    await unlockWithRecovery(await file.text());
  };

  return (
    <div className="login-gate">
      <div className="login-screen">
        <form className="login-card" onSubmit={submit}>
          <h1>
            note<em>.</em>md
          </h1>
          <div className="sub">
            {hasToken
              ? "输入口令解锁本机加密（口令只在本地派生，服务端只见登录凭证哈希）"
              : "本地优先：不登录也能用；登录后开启跨设备同步与 AI（口令永不上传）"}
          </div>

          {canRegister && (
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <button
                type="button"
                className={`nb-btn${mode === "login" ? " solid" : ""}`}
                style={{ flex: 1 }}
                onClick={() => setMode("login")}
              >
                登录
              </button>
              <button
                type="button"
                className={`nb-btn${mode === "register" ? " solid" : ""}`}
                style={{ flex: 1 }}
                onClick={() => setMode("register")}
              >
                创建账号
              </button>
            </div>
          )}

          <label htmlFor="nc-username">用户名</label>
          <input
            id="nc-username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.trim())}
            placeholder="小写字母/数字/_/-"
          />

          <label htmlFor="nc-password">口令</label>
          <input
            id="nc-password"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="本地派生登录凭证与加密密钥"
          />

          {mode === "register" && policy === "invite" && (
            <>
              <label htmlFor="nc-invite">邀请码</label>
              <input
                id="nc-invite"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="邀请码"
              />
            </>
          )}

          {error && <div className="err">{error}</div>}

          <div className="actions">
            <button className="nb-btn solid" type="submit" disabled={busy}>
              {busy ? "处理中…" : mode === "register" ? "创建并解锁" : hasToken ? "解锁" : "登录"}
            </button>
            <button
              className="nb-btn"
              type="button"
              onClick={() => rekInputRef.current?.click()}
              title="用恢复密钥文件解锁（可离线）"
            >
              恢复密钥
            </button>
          </div>
          <input
            ref={rekInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => void onRekFile(e.target.files?.[0])}
          />

          {!hasToken && (
            <div className="switch">
              <a onClick={dismissGuest}>先离线使用 →</a>
              <span style={{ margin: "0 8px", color: "var(--tx-3)" }}>|</span>
              <a
                onClick={() => {
                  const next = window.prompt("服务端地址（空 = 同源）", config.serverUrl);
                  if (next !== null) {
                    setServerUrl(next);
                    setServer(config.serverUrl);
                  }
                }}
              >
                服务器{server ? `：${server}` : "：同源"}
              </a>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
