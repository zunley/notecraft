import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发时前端代理到本地后端（服务端仅提供 auth/sync/中继，见 docs/ARCHITECTURE.md）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
  build: { target: "es2022" },
});
