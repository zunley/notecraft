/**
 * 编辑器：CodeMirror 6，编辑 / 分栏预览 / 预览三态（DESIGN.md §3.3）。
 *
 * - 保存走本地 writeFile（防抖 ~2s，baseHash 乐观锁，冲突抛 ConflictError → 状态胶囊提示）；
 * - 预览渲染 lib/markdown（唯一实现），wiki 内链点击 → lib/search 解析后跳转（不存在则新建）；
 * - 冲突（本地文件被别处修改）时提供「覆盖」重试——服务端同步冲突副本在阶段 5。
 * - 需实测 iOS WKWebView 触控选区与软键盘顶起（里程碑 M5 验证项）。
 */
import { useEffect, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { parseWikiHref, renderMarkdown } from "../lib/markdown";
import { resolveWikiPath } from "../lib/search";
import { flatFiles, useNotesStore } from "../state/notes";

const SAVE_DEBOUNCE_MS = 800; // 本地保存防抖（同步推送防抖 ~2s 另在 engine）

/** 内链补全：`[[` 后列出全部笔记路径（与 ⌘K 同源 tree，M6 打磨项） */
function wikiCompletion(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/\[\[[^\]\n]*/);
  if (!match && !ctx.explicit) return null;
  const from = match ? match.from + 2 : ctx.pos;
  const files = flatFiles(useNotesStore.getState().tree);
  return {
    from,
    options: files.map((f) => ({ label: f, detail: "笔记" })),
    validFor: /^[\w\u4e00-\u9fa5./-]*$/,
  };
}

export function Editor() {
  const currentPath = useNotesStore((s) => s.currentPath);
  const contentVersion = useNotesStore((s) => s.contentVersion);
  const viewMode = useNotesStore((s) => s.viewMode);
  const status = useNotesStore((s) => s.status);
  const lastSavedAt = useNotesStore((s) => s.lastSavedAt);
  const error = useNotesStore((s) => s.error);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 未落盘草稿及其所属路径——切换文件时兜底，防串写/防丢稿 */
  const pendingRef = useRef<{ path: string; text: string } | null>(null);
  const draftRef = useRef(""); // ⌘S 取最新草稿用
  const [draft, setDraft] = useState("");
  const mounted = currentPath !== null;

  // 视图只建一次（避免重渲染重建导致光标/历史丢失）
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      extensions: [
        EditorView.lineWrapping,
        drawSelection(),
        history(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        autocompletion({ override: [wikiCompletion] }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          setDraft(text);
          draftRef.current = text;
          pendingRef.current = { path: useNotesStore.getState().currentPath ?? "", text };
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            const p = pendingRef.current;
            if (p?.path) void useNotesStore.getState().save(p.text, { expectedPath: p.path });
            pendingRef.current = null;
          }, SAVE_DEBOUNCE_MS);
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [mounted]);

  // 切换文件 / 外部重载（contentVersion）：先兜底处理旧草稿，再同步编辑器内容
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingRef.current;
    const { currentContent } = useNotesStore.getState();

    if (pending && pending.path === currentPath && pending.text !== currentContent) {
      // 同路径外部重载（如 AI 覆写）：保留本地草稿，按乐观锁落盘（不符即 conflict，不覆盖）
      pendingRef.current = null;
      void useNotesStore.getState().save(pending.text);
      setDraft(pending.text);
      draftRef.current = pending.text;
      return;
    }
    if (pending?.path && pending.path !== currentPath) {
      void useNotesStore.getState().save(pending.text, { expectedPath: pending.path });
    }
    pendingRef.current = null;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: currentContent } });
    setDraft(currentContent);
    draftRef.current = currentContent;
  }, [currentPath, contentVersion]);

  const flushSave = (content: string, force = false) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void useNotesStore.getState().save(content, { force });
  };

  // ⌘S 立即落盘（App 全局快捷键派发）
  useEffect(() => {
    const onSave = () => flushSave(draftRef.current);
    window.addEventListener("notecraft:save", onSave);
    return () => window.removeEventListener("notecraft:save", onSave);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 内链点击：不存在则新建（本地优先，零网络）
  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const target = parseWikiHref(anchor.getAttribute("href") ?? "");
    if (target === null) return; // 普通外链
    e.preventDefault();
    const notes = useNotesStore.getState();
    if (!notes.currentPath) return;
    const files = flatFiles(notes.tree);
    const resolved = resolveWikiPath(files, target, notes.currentPath);
    if (resolved) void notes.open(resolved);
    else {
      const dir = notes.currentPath.includes("/")
        ? notes.currentPath.slice(0, notes.currentPath.lastIndexOf("/"))
        : "";
      const name = target.endsWith(".md") ? target : `${target}.md`;
      void notes.createFile(dir ? `${dir}/${name}` : name, `# ${target.replace(/\.md$/, "")}\n`);
    }
  };

  if (!currentPath) {
    return (
      <div className="editor-wrap">
        <div className="empty-editor">
          <div className="big">✦</div>
          选择左侧笔记开始编辑
          <br />
          <small>全部功能离线可用 · 文件就是磁盘上的纯 Markdown</small>
        </div>
      </div>
    );
  }

  const showEditor = viewMode !== "preview";
  const showPreview = viewMode !== "edit";

  return (
    <div className="editor-wrap">
      <article className="paper" style={showEditor && showPreview ? { maxWidth: "none", padding: "28px 32px" } : undefined}>
        <div className={`doc-status${status === "saving" ? " saving" : ""}${status === "conflict" ? " conflict" : ""}`}>
          {status === "saving" && "● 保存中…"}
          {status === "saved" && `● 已保存${lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString()}` : ""}`}
          {status === "conflict" && (
            <>
              ● 冲突（别处已修改）
              <button
                className="nb-btn"
                style={{ padding: "1px 8px", fontSize: "0.68rem", marginLeft: 6 }}
                onClick={() => flushSave(draft, true)}
              >
                覆盖
              </button>
            </>
          )}
          {(status === "idle" || status === "loading") && "● 就绪"}
        </div>
        <div className="doc-meta">{currentPath}</div>
        {error && status === "idle" && <div className="doc-status conflict">● {error}</div>}

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {showEditor && (
            <div
              ref={hostRef}
              className="cm-host"
              style={{ flex: showPreview ? "1 1 50%" : "1 1 100%", minWidth: 0 }}
            />
          )}
          {showPreview && (
            <div
              className="md"
              style={{ flex: showEditor ? "1 1 50%" : "1 1 100%", minWidth: 0 }}
              onClick={onPreviewClick}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
            />
          )}
        </div>
      </article>
    </div>
  );
}
