/**
 * 文件树：新建 / 重命名 / 删除——全部走本地 StorageAdapter，离线可用（DESIGN.md §3.3）。
 *
 * - 新建一律以树内行内输入呈现，类型由输入结尾决定（与 note.md 规则一致）：
 *   以 `/` 结尾 = 新建文件夹，以 `.md` 结尾 = 新建文件，其余结尾拒绝提交并提示；
 *   支持 `a/b/`、`a/b.md` 嵌套路径；目标目录前缀在输入行内明确可见；
 * - 双击文件重命名；hover × 移入 .trash/（回收站属笔记本内容、随同步走）；
 * - 目录 hover ＋ 行内新建（mockup 的 new-row 形态）；
 * - 移动端为侧滑抽屉（open/onClose 由 App 注入，样式在 theme.css）。
 */
import { useRef, useState } from "react";
import { useNotesStore, type TreeNode } from "../state/notes";

function ensureMd(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
}

type ParsedCreate = { name: string; isDir: boolean } | "empty" | "invalid";

/**
 * 新建命名校验（与 note.md 一致）：以 `/` 结尾 = 文件夹；以 `.md` 结尾 = 文件；
 * 其余结尾拒绝（invalid）。支持嵌套路径（`a/b/`、`a/b.md`），但每段必须非空
 * 且不得为 `.` / `..`（路径穿越防护）；空输入 = 取消（empty）。
 */
function parseCreate(raw: string): ParsedCreate {
  const name = raw.trim();
  if (!name) return "empty";
  const isDir = name.endsWith("/");
  if (!isDir && !name.endsWith(".md")) return "invalid";
  const clean = isDir ? name.replace(/\/+$/, "") : name;
  const segs = clean.split("/");
  if (segs.some((s) => !s || s === "." || s === "..")) return "invalid";
  return { name: clean, isDir };
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
  const children = node.children ?? [];
  const isActiveIn = activePath?.startsWith(`${node.entry.path}/`) ?? false;

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
              <NewRow dir={node.entry.path} onDone={() => setCreatingIn(null)} />
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

/**
 * 树内行内新建输入（mockup 的 new-row 形态）：类型由输入结尾决定，
 * ↵ 或失焦提交，Esc 或空输入取消；非法结尾拒绝提交并就地提示（校验）。
 */
function NewRow({ dir, onDone }: { dir: string; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createFile = useNotesStore((s) => s.createFile);
  const createDir = useNotesStore((s) => s.createDir);

  const submit = () => {
    const parsed = parseCreate(value);
    if (parsed === "empty") {
      onDone();
      return;
    }
    if (parsed === "invalid") {
      setInvalid(true);
      inputRef.current?.focus(); // 拒绝提交后保持输入，就地改
      return;
    }
    onDone();
    const path = dir ? `${dir}/${parsed.name}` : parsed.name;
    if (parsed.isDir) void createDir(path);
    else void createFile(path); // 新建文件即打开
  };

  return (
    <div className="new-row">
      <span className="target">{dir ? `${dir}/` : "根/"}</span>
      <input
        ref={inputRef}
        autoFocus
        placeholder="文件名.md 或 目录名/"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
        onBlur={submit}
      />
      <span className={`hint${invalid ? " err" : ""}`}>
        {invalid ? "以 / 或 .md 结尾" : "↵ 创建 · Esc"}
      </span>
    </div>
  );
}

export function FileTree({ open, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const tree = useNotesStore((s) => s.tree);
  const currentPath = useNotesStore((s) => s.currentPath);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);

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
            <NewRow dir="" onDone={() => setCreatingIn(null)} />
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
