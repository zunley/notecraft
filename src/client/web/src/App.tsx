/**
 * 根组件：布局骨架（桌面双栏 / 移动单栏，DESIGN.md §3.5）。
 *
 * - 启动时注入平台 StorageAdapter（storage/index 工厂，UI 零分叉）；
 * - 同步引擎（sync/engine）在存储就绪后装配：防抖推送、前后台对齐、投影写入 state/sync；
 * - 顶栏：品牌、当前路径、视图切换（编辑/分栏/预览）、搜索（⌘K，阶段 8）、移动端抽屉开关；
 * - 状态栏：同步投影 + 立即同步 + 账户（改口令/注销/退出）；AI 悬浮窗（工具循环）；
 * - 登录门（Login）——可关，本地存储始终可用（本地优先：登录只为解锁/同步/AI）。
 */
import { useEffect, useRef, useState } from "react";
import { Chat, Editor, FileTree, Login, StatusBar } from "./features";
import { createStorage } from "./storage";
import { SyncEngine } from "./sync";
import { useAuthStore, useNotesStore, useSyncStore, type ViewMode } from "./state";

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "edit", label: "编辑" },
  { mode: "split", label: "分栏" },
  { mode: "preview", label: "预览" },
];

export function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const currentPath = useNotesStore((s) => s.currentPath);
  const viewMode = useNotesStore((s) => s.viewMode);
  const setViewMode = useNotesStore((s) => s.setViewMode);
  const online = useSyncStore((s) => s.online);
  const patchSync = useSyncStore((s) => s.patch);
  const hasToken = useAuthStore((s) => s.hasToken);
  const unlocked = useAuthStore((s) => s.unlocked);
  const guest = useAuthStore((s) => s.guest);

  // 登录门：无 token 且未选离线使用 → 登录/创建；有 token 但 MK 不在内存 → 解锁门
  // ★ 门可关（离线使用）且不阻断渲染下的本地功能——本地优先铁律
  const needGate = (hasToken && !unlocked) || (!hasToken && !guest);

  const engineRef = useRef<SyncEngine | null>(null);

  // 启动：注入平台存储 + 认证状态 + 离线/在线投影（DESIGN.md §3.6 静默降级）
  useEffect(() => {
    let cancelled = false;
    void useAuthStore.getState().init();
    createStorage()
      .then((storage) => useNotesStore.getState().init(storage))
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setBootError(String((e as Error).message ?? e));
      });
    const onOnline = () => patchSync({ online: true });
    const onOffline = () => patchSync({ online: false });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [patchSync]);

  // 同步引擎装配（composition in App：state 不依赖 sync，钩子由这里注入）
  useEffect(() => {
    if (!ready) return;
    const engine = new SyncEngine({
      getStorage: () => useNotesStore.getState().storage,
      patch: (p) => useSyncStore.getState().patch(p),
      onFileAdopted: (path) => {
        const notes = useNotesStore.getState();
        if (notes.currentPath === path) void notes.open(path); // 重载被覆盖的当前文件
      },
    });
    engineRef.current = engine;
    useNotesStore.setState({ onLocalChange: (path) => engine.touch(path) });
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
      useNotesStore.setState({ onLocalChange: undefined });
    };
  }, [ready]);

  if (bootError) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>
            note<em>.</em>md
          </h1>
          <div className="err">存储初始化失败：{bootError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="nb-btn drawer-toggle"
          onClick={() => setDrawerOpen((v) => !v)}
          title="文件树"
        >
          ☰
        </button>
        <div className="brand">
          note<em>.</em>md
        </div>
        <div className="path">{currentPath ?? "本地笔记本"}</div>
        <div className="spacer" />
        <button className="nb-btn" disabled title="搜索（阶段 8 / M6 接入）">
          搜索<kbd>⌘K</kbd>
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          {VIEW_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              className={`nb-btn${viewMode === mode ? " solid" : ""}`}
              onClick={() => setViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="layout">
        <div className={`drawer-mask${drawerOpen ? " show" : ""}`} onClick={() => setDrawerOpen(false)} />
        <FileTree open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
        {ready ? <Editor /> : <div className="editor-wrap"><div className="empty-editor">正在初始化本地存储…</div></div>}
      </div>

      <StatusBar onSyncNow={() => void engineRef.current?.syncNow()} />

      <button className="fab" title="AI 助手" onClick={() => setChatOpen((v) => !v)}>
        ✦
      </button>
      {chatOpen && (
        <div className="ai-panel">
          <Chat onClose={() => setChatOpen(false)} />
        </div>
      )}
      {!online && (
        <div className="msg-sys" style={{ position: "fixed", bottom: 34, left: 0, right: 0 }}>
          离线——本地功能照常，恢复网络后自动同步
        </div>
      )}
      {/* 登录门（阶段 3 / M1-c）：登录即解锁；本地功能不被阻塞（本地优先） */}
      {needGate && <Login />}
    </div>
  );
}
