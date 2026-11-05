/**
 * ⌘K 搜索面板：全文搜索 + 文件名跳转（M6 打磨项）。
 *
 * ★ 搜索单源：与 AI 工具 search_files 共用 lib/search——禁止两处各写一份
 *   （ARCHITECTURE.md §3）。结果选中 → notes.open；Esc 关闭。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { searchFiles, type SearchHit } from "../lib/search";
import { flatFiles, useNotesStore } from "../state/notes";

interface Item {
  key: string;
  label: string;
  sub: string;
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tree = useNotesStore((s) => s.tree);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 内容搜索（防抖；storage 就绪后才可用）
  useEffect(() => {
    const q = query.trim();
    const storage = useNotesStore.getState().storage;
    if (!q || !storage) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchFiles(storage, q, 30).then((found) => {
        if (!cancelled) setHits(found);
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    for (const f of flatFiles(tree)) {
      if (!q || f.toLowerCase().includes(q)) {
        out.push({
          key: `f:${f}`,
          label: f.replace(/\.md$/, ""),
          sub: "笔记",
          run: () => void useNotesStore.getState().open(f),
        });
      }
    }
    for (const h of hits) {
      out.push({
        key: `h:${h.path}:${h.line}`,
        label: `${h.path.replace(/\.md$/, "")}:${h.line}`,
        sub: h.text,
        run: () => void useNotesStore.getState().open(h.path),
      });
    }
    return out.slice(0, 40);
  }, [query, hits, tree]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div className="palette-mask" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="搜索笔记内容与文件名…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(items[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        {items.length === 0 ? (
          <div className="none">{query.trim() ? "没有命中" : "输入关键词开始搜索（内容 + 文件名）"}</div>
        ) : (
          <ul>
            {items.map((item, i) => (
              <li
                key={item.key}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span>{item.label}</span>
                <span className="sub">{item.sub}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
