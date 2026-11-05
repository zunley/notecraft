/**
 * 文件树：新建 / 重命名 / 删除——全部走本地 StorageAdapter，离线可用（DESIGN.md §3.3）。
 *
 * - 双击文件重命名；hover × 移入 .trash/（回收站属笔记本内容、随同步走）；
 * - 目录 hover ＋ 行内新建（mockup 的 new-row 形态）；
 * - 移动端为侧滑抽屉（open/onClose 由 App 注入，样式在 theme.css）。
 */
import { useState } from "react";
import { useNotesStore, type TreeNode } from "../state/notes";

function ensureMd(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
}

interface RowProps {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  creatingIn: string | null;
  setCreatingIn: (v: string | null) => void;
  onNavigate?: () => void;
}

function DirRow({ node, depth, activePath, creatingIn, setCreatingIn, onNavigate }: RowProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [name, setName] = useState("");
  const createFile = useNotesStore((s) => s.createFile);
  const children = node.children ?? [];
  const isActiveIn = activePath?.startsWith(`${node.entry.path}/`) ?? false;

  const submit = () => {
    const file = ensureMd(name);
    if (file) void createFile(node.entry.path ? `${node.entry.path}/${file}` : file);
    setName("");
    setCreatingIn(null);
  };

  return (
    <li>
      <div
        className="dir"
        style={{ paddingLeft: 10 + depth * 6 }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="caret">{collapsed ? "▸" : "▾"}</span>
        <span className="name">{node.entry.name}</span>
        <button
          className="plus"
          title="在此目录新建"
          onClick={(e) => {
            e.stopPropagation();
            setCreatingIn(node.entry.path);
          }}
        >
          ＋
        </button>
      </div>
      {(!collapsed || isActiveIn || creatingIn === node.entry.path) && (
        <ul>
          {children.map((child) => (
            <NodeRow key={child.entry.path} node={child} depth={depth + 1} activePath={activePath}
              creatingIn={creatingIn} setCreatingIn={setCreatingIn} onNavigate={onNavigate} />
          ))}
          {creatingIn === node.entry.path && (
            <li>
              <NewRow target={`${node.entry.path}/`} value={name} onChange={setName}
                onSubmit={submit} onCancel={() => { setName(""); setCreatingIn(null); }} />
            </li>
          )}
          {children.length === 0 && creatingIn !== node.entry.path && (
            <li className="empty">空目录</li>
          )}
        </ul>
      )}
    </li>
  );
}

function FileRow({ node, activePath, onNavigate }: { node: TreeNode; activePath: string | null; onNavigate?: () => void }) {
  const open = useNotesStore((s) => s.open);
  const remove = useNotesStore((s) => s.remove);
  const rename = useNotesStore((s) => s.rename);
  const active = activePath === node.entry.path;

  const doRename = () => {
    const next = window.prompt("重命名（含 .md）", node.entry.name);
    if (!next || next === node.entry.name) return;
    const cleaned = ensureMd(next);
    if (!cleaned) return;
    const dir = node.entry.path.includes("/")
      ? node.entry.path.slice(0, node.entry.path.lastIndexOf("/"))
      : "";
    void rename(node.entry.path, dir ? `${dir}/${cleaned}` : cleaned);
  };

  return (
    <li>
      <div
        className={`file${active ? " active" : ""}`}
        onClick={() => {
          void open(node.entry.path);
          onNavigate?.();
        }}
        onDoubleClick={doRename}
        title={`${node.entry.path}（双击重命名）`}
      >
        <span>{node.entry.name}</span>
        <button
          className="del"
          title="移入回收站"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`将「${node.entry.name}」移入回收站？`)) void remove(node.entry.path);
          }}
        >
          ×
        </button>
      </div>
    </li>
  );
}

function NodeRow(props: RowProps) {
  return props.node.entry.type === "dir" ? (
    <DirRow {...props} />
  ) : (
    <FileRow node={props.node} activePath={props.activePath} onNavigate={props.onNavigate} />
  );
}

function NewRow(props: {
  target: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="new-row">
      <span className="target">{props.target}</span>
      <input
        autoFocus
        placeholder="文件名.md"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onSubmit();
          if (e.key === "Escape") props.onCancel();
        }}
        onBlur={props.onCancel}
      />
      <span className="hint">↵ 创建 · Esc 取消</span>
    </div>
  );
}

export function FileTree({ open, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const tree = useNotesStore((s) => s.tree);
  const currentPath = useNotesStore((s) => s.currentPath);
  const createFile = useNotesStore((s) => s.createFile);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [rootName, setRootName] = useState("");

  const createRoot = () => {
    const file = ensureMd(rootName);
    if (file) void createFile(file);
    setRootName("");
    setCreatingIn(null);
  };

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <ul className="tree">
        {tree.length === 0 && <li className="empty">还没有笔记——点下方「新建」开始</li>}
        {tree.map((node) => (
          <NodeRow key={node.entry.path} node={node} depth={0} activePath={currentPath}
            creatingIn={creatingIn} setCreatingIn={setCreatingIn} onNavigate={onNavigate} />
        ))}
        {creatingIn === "" && (
          <li>
            <NewRow target="/" value={rootName} onChange={setRootName}
              onSubmit={createRoot} onCancel={() => { setRootName(""); setCreatingIn(null); }} />
          </li>
        )}
      </ul>
      <div className="sidebar-actions">
        <button className="nb-btn solid" onClick={() => setCreatingIn("")}>
          ＋ 新建
        </button>
      </div>
    </aside>
  );
}
