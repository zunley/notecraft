/**
 * 全局状态：zustand，只有三个 slice——auth / sync / notes（DESIGN.md §3.7）。
 *
 * - auth：登录态、unlock 态、token（订阅方：Login）
 * - sync：待同步计数 / 同步中 / 离线（订阅方：StatusBar）
 * - notes：当前文件树、打开的编辑器状态（订阅方：FileTree / Editor）
 *
 * ★ 明确不做：Redux、事件总线、持久化中间件链——三个切片足够，多了再议。
 */

// TODO: auth store —— login()/logout()/unlock 态
// TODO: sync store —— pending/syncing/online
// TODO: notes store —— 树与当前打开文件
