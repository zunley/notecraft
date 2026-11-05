/**
 * 应用入口：挂载 React、引入主题与字体（fontsource 随包离线可用）。
 *
 * TODO:
 * - 引入 theme.css 与 @fontsource 三项字体
 * - 注入平台 StorageAdapter（桌面/移动 TauriFs、Web OPFS）
 * - 挂载 App
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
