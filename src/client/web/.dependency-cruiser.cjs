/**
 * 依赖铁律（ARCHITECTURE.md §3）——分层不靠自觉，越界 import 在 CI 即红。
 *
 * 检查：npm run lint:deps（depcruise src）
 * 只覆盖 TypeScript 侧；Python 侧的分层规则（core 禁 import fastapi、
 * core/api 禁 import adapters）由 src/server/tests 中的架构测试覆盖。
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "features-to-internal",
      severity: "error",
      comment:
        "features/* 只准 import state/、storage 接口、lib/——不 import crypto 密钥材料、sync/ai 内部（ARCHITECTURE.md §3）。",
      from: { path: "^src/features/" },
      to: { path: "^src/(crypto|sync|ai)/" },
    },
    {
      name: "state-to-features",
      severity: "error",
      comment: "state/* 不 import features/*（单向依赖，DESIGN.md §3.7）。",
      from: { path: "^src/state/" },
      to: { path: "^src/features/" },
    },
    {
      name: "ai-to-ui",
      severity: "error",
      comment:
        "ai/ 不 import features/*（工具循环与 React 解耦）；ai/tools.ts 只依赖 StorageAdapter + lib/search。",
      from: { path: "^src/ai/" },
      to: { path: "^src/(features|state)/" },
    },
    {
      name: "tools-no-react",
      severity: "error",
      comment: "ai/tools.ts 是纯注册表，不依赖 React/state（ARCHITECTURE.md §3 依赖铁律）。",
      from: { path: "^src/ai/tools\\.ts$" },
      to: { path: "^react" },
    },
    {
      name: "tauri-only-in-fs-adapter",
      severity: "error",
      comment:
        "@tauri-apps/* 只允许出现在 storage/tauriFs.ts 与壳层——「UI 零分叉」由此保证（ARCHITECTURE.md §3）。",
      from: { path: "^src", pathNot: "^src/storage/tauriFs\\.ts$" },
      to: { path: "^@tauri-apps" },
    },
    {
      name: "no-crypto-outside",
      severity: "error",
      comment:
        "密钥材料只活在 crypto/keystore.ts；只有 sync/codec 与 state/auth 等持密调用方可以 import（ARCHITECTURE.md §8 纪律 3）。",
      from: { path: "^src/(features|ai)/" },
      to: { path: "^src/crypto/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
