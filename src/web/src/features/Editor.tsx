/**
 * 编辑器：CodeMirror 6，内联渲染方案 A + 分栏预览方案 B（沿用 v1）。
 *
 * TODO:
 * - 保存走本地 writeFile（乐观锁 hash 与 v1 同机制，冲突抛 ConflictError）
 * - 需实测 iOS WKWebView 触控选区与软键盘顶起（里程碑 M5 验证项）
 */
export function Editor() {
  return <div>编辑器（骨架）</div>;
}
