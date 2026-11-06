/**
 * CM6 内联渲染（模式 A，「编辑即所见」——与 note.md 同方案）：
 * - 非光标行隐藏 markdown 标记（标题井号、强调符号、行内代码反引号、链接括号/URL），
 *   基于语法树 token（HyperMD 同款思路），比正则稳健；
 * - 光标所在行的标记保持可见（源码在光标处展开，边写边见样式）；
 * - 行装饰：标题行 .cm-hN、引用行 .cm-quote（CSS 用 padding 撑开，**禁止 margin**——
 *   margin 折叠会破坏 CM6 的行高测量，导致光标垂直移动错乱）。
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

interface Entry {
  from: number;
  to: number;
  deco: Decoration;
}

const HIDE = Decoration.replace({});

/** 需要隐藏的语法树节点（标记类 token）。 */
const HIDE_NAMES = new Set([
  "HeaderMark",
  "QuoteMark",
  "EmphasisMark",
  "LinkMark",
  "CodeMark",
  "StrikethroughMark",
  "CodeInfo",
  "URL",
]);

function lineClass(view: EditorView, lineFrom: number): string {
  const tree = syntaxTree(view.state);
  for (let node: SyntaxNode | null = tree.resolveInner(lineFrom, 1); node; node = node.parent) {
    const name = node.name;
    const h = /^ATXHeading([1-6])$/.exec(name);
    if (h) return `cm-h${h[1]}`;
    if (name === "Blockquote") return "cm-quote";
    if (name === "Document") break;
  }
  return "";
}

function buildDecos(view: EditorView): DecorationSet {
  const entries: Entry[] = [];
  const sel = view.state.selection.ranges;
  const overlapsSel = (from: number, to: number) =>
    sel.some((r) => r.from <= to && r.to >= from);
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    // 行装饰（零宽，按行遍历）
    let pos = from;
    while (pos <= to && pos <= view.state.doc.length) {
      const line = view.state.doc.lineAt(pos);
      const cls = lineClass(view, line.from);
      if (cls) {
        entries.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: cls }),
        });
      }
      if (line.to >= view.state.doc.length) break;
      pos = line.to + 1;
    }

    // 标记隐藏（语法树 token，光标所在行的标记保持可见）
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (
          (HIDE_NAMES.has(node.name) || node.name === "URL") &&
          node.to > node.from &&
          !overlapsSel(node.from, node.to)
        ) {
          entries.push({ from: node.from, to: node.to, deco: HIDE });
        }
      },
    });
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const e of entries) {
    if (e.from === e.to) {
      builder.add(e.from, e.from, e.deco);
    } else if (e.from >= lastTo) {
      builder.add(e.from, e.to, e.deco);
      lastTo = e.to;
    }
  }
  return builder.finish();
}

export const inlinePreview = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecos(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          this.decorations = buildDecos(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
];
