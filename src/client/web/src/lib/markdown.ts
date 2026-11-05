/**
 * Markdown 解析与渲染（markdown-it）——预览与 AI 卡片共用。
 *
 * wiki 内链 [[目标|别名]] 在渲染前改写为 `#wiki/<目标>` 锚点，
 * 点击拦截由调用方（features/Editor 预览面板）负责——本文件不做导航。
 * 已知取舍：代码块内的 [[...]] 也会被改写（渲染成普通链接文本，无副作用）。
 */
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

function escapeLabel(label: string): string {
  return label.replace(/([\[\]])/g, "\\$1");
}

/** 渲染为安全 HTML（html:false——不放行内联 HTML） */
export function renderMarkdown(source: string): string {
  const withWiki = source.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_all, target: string, label?: string) => {
      const t = String(target).trim();
      const l = (label ?? target).trim();
      return `[${escapeLabel(l)}](#${encodeURIComponent(`wiki/${t}`)})`;
    },
  );
  return md.render(withWiki);
}

/** 预览点击中解析 wiki 锚点：返回目标名，非 wiki 链接返回 null */
export function parseWikiHref(href: string): string | null {
  if (!href.startsWith("#wiki/")) return null;
  try {
    return decodeURIComponent(href.slice("#wiki/".length));
  } catch {
    return href.slice("#wiki/".length);
  }
}
