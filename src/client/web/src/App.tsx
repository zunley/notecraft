/**
 * 根组件：布局骨架（桌面双栏 / 移动单栏，DESIGN.md §3.5）。
 *
 * - 启动时注入平台 StorageAdapter（storage/index 工厂，UI 零分叉）；
 * - 同步引擎（sync/engine）在存储就绪后装配：防抖推送、前后台对齐、投影写入 state/sync；
 * - 顶栏：品牌、当前路径、保存状态胶囊（note.md 设计：状态在顶栏、正文只留内容）、
 *   视图切换（编辑/分栏/预览）、搜索（⌘K，阶段 8）、移动端抽屉开关；
 * - 状态栏：同步投影 + 立即同步 + 账户（改口令/注销/退出）；AI 悬浮窗（工具循环）；
 * - 快捷键平台归一（⌘/Ctrl 等价，DESIGN §3.5）：⌘J AI 面板、⌘S 落盘、⌘K 搜索、Esc 关闭；
 * - 登录门（Login）——永不主动弹出，只在用户点底部「登录 / 解锁」后出现；
 *   本地存储始终可用（本地优先：登录只为解锁/同步/AI）。
 */
import { useEffect, useRef, useState } from "react";
import { Chat, CommandPalette, Editor, FileTree, Login, StatusBar } from "./features";
import { createStorage } from "./storage";
import { SyncEngine } from "./sync";
import { useAuthStore, useNotesStore, useSyncStore, type SaveStatus, type ViewMode } from "./state";

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "edit", label: "编辑" },
  { mode: "split", label: "分栏" },
  { mode: "preview", label: "预览" },
];

/** 保存状态文案（顶栏胶囊；正文不放状态——note.md 设计） */
function saveText(status: SaveStatus, error: string | null): string {
  switch (status) {
    case "saving":
      return "保存中…";
    case "saved":
      return "✓ 已保存";
    case "conflict":
      return "版本冲突";
    case "loading":
      return "加载中…";
    default:
      return error ? "保存失败" : "";
  }
}

export function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const currentPath = useNotesStore((s) => s.currentPath);
  const viewMode = useNotesStore((s) => s.viewMode);
  const setViewMode = useNotesStore((s) => s.setViewMode);
  const saveStatus = useNotesStore((s) => s.status);
  const saveError = useNotesStore((s) => s.error);
  const lastSavedAt = useNotesStore((s) => s.lastSavedAt);
  const online = useSyncStore((s) => s.online);
  const patchSync = useSyncStore((s) => s.patch);
  const gate = useAuthStore((s) => s.gate);
  const pendingRecoveryKey = useAuthStore((s) => s.pendingRecoveryKey);

  // 登录门：只在用户点击底部「登录 / 解锁」后打开（openGate），永不自动弹出
  // ★ 门可关（离线使用 / 稍后再说）且不阻断渲染下的本地功能——本地优先铁律
  const needGate = gate;

  const engineRef = useRef<SyncEngine | null>(null);

  // 全局快捷键（⌘/Ctrl 平台归一；移动端由等价按钮提供，DESIGN §3.5）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "j") {
        e.preventDefault();
        setChatOpen((v) => !v);
      } else if (mod && key === "s") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("notecraft:save")); // Editor 立即落盘
      } else if (mod && key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v); // ⌘K 搜索面板
      } else if (e.key === "Escape") {
        setChatOpen(false);
        setDrawerOpen(false);
        setPaletteOpen(false);
        // 登录门可 Esc 关闭（恢复密钥导出页除外——那一步不能跳过）
        if (!useAuthStore.getState().pendingRecoveryKey) useAuthStore.getState().closeGate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        {currentPath && (
          <div
            className={`save-status${saveStatus === "saving" ? " saving" : ""}${
              saveStatus === "conflict" || (saveStatus === "idle" && saveError) ? " err" : ""
            }`}
            title={lastSavedAt ? `最后保存 ${new Date(lastSavedAt).toLocaleTimeString()}` : undefined}
          >
            {saveText(saveStatus, saveError)}
          </div>
        )}
        <div className="spacer" />
        <button className="nb-btn search-btn" onClick={() => setPaletteOpen(true)} title="搜索（⌘K）">
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
      {(needGate || pendingRecoveryKey) && <Login />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
