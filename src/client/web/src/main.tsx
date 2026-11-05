/**
 * 应用入口：挂载 React、引入主题与字体（fontsource 随包离线可用）。
 *
 * - StorageAdapter 由 App 经 storage/index 工厂注入（UI 零分叉，平台零判断）；
 * - 字体三项均为 OFL 许可，自托管分片打包（docs/style/README.md）。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "@fontsource/noto-sans-sc/900.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./theme.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
