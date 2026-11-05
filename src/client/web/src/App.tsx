/**
 * 根组件：布局骨架（桌面双栏 / 移动单栏，DESIGN.md §3.5）。
 *
 * - 启动时注入平台 StorageAdapter（storage/index 工厂，UI 零分叉）；
 * - 顶栏：品牌、当前路径、视图切换（编辑/分栏/预览）、搜索（⌘K，阶段 8）、移动端抽屉开关；
 * - 状态栏订阅 sync 切片（阶段 5 接满）；AI 悬浮窗（阶段 4 接满）；
 * - 登录门（Login，阶段 3）——登录前仅提示，本地存储仍可用（本地优先：登录只为解锁/同步）。
 */
import { useEffect, useState } from "react";
import { Chat, Editor, FileTree, StatusBar } from "./features";
import { createStorage } from "./storage";
import { useNotesStore, useSyncStore, type ViewMode } from "./state";

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

  // 启动：注入平台存储 + 离线/在线投影（DESIGN.md §3.6 静默降级）
  useEffect(() => {
    let cancelled = false;
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

      <StatusBar />

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
      {/* 登录门在阶段 3（M1-c）接入：本地功能不被阻塞（本地优先） */}
    </div>
  );
}
