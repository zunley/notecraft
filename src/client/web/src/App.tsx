/**
 * 根组件：布局骨架。
 *
 * TODO（见 docs/DESIGN.md §3.5）：
 * - 登录态判定（登录即解锁：口令派生 + protected_key 解封，§6.3）
 * - 桌面双栏 / 移动单栏两档布局（侧滑文件树抽屉、AI 面板全屏 sheet）
 * - 状态栏：待同步计数 / 同步中 / 离线指示
 */
export function App() {
  return <div className="app">notecraft（骨架）</div>;
}
