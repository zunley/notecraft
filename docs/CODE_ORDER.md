# 编码顺序（实施清单）

> 本清单是按依赖关系 + [DESIGN.md](DESIGN.md) §8 里程碑 排定的**实现顺序**：
> 先做什么、再做什么、每步的出口条件。协议与形状的权威仍是
> [API.md](API.md) / [ARCHITECTURE.md](ARCHITECTURE.md)，本文件只回答「顺序」。
>
> 每个阶段结束为一次提交，且都是可验证状态（测试/构建通过）。

## 阶段 0 · 公共地基（两侧契约层，无业务）

1. **服务端 `app/config.py`** — 全部 `NOTE_MD_*` / `OPENAI_*` 环境变量 + API.md §7 默认值（后面所有层都读它）
2. **服务端 `app/errors.py` / `types.py` / `ports.py` 核对补全** — 与 API.md §2 错误表、端口签名一致
3. **客户端 `lib/config.ts`（运行环境加载 serverUrl）、`lib/errors.ts`（领域错误单源）** — `lib/api.ts` 的翻译目标
4. **`docs/style/` → `theme.css` design tokens 迁移** + dependency-cruiser 依赖铁律规则（ARCHITECTURE.md §3，越界 import 在 CI 即红）

**出口**：`make test` 可跑（占位通过）、`npm run build` 通过、`npm run lint:deps` 无越界。

## 阶段 1 · M1-a 本地存储与本地业务（纯客户端，零网络依赖）

5. **`storage/opfs.ts` + `storage/index.ts` 平台工厂**（接口 `storage/types.ts` 已定稿；Tauri 实现留到 M4）
6. **`lib/search.ts`（搜索唯一实现）、`lib/markdown.ts`** — ⌘K 与 AI 工具共用，必须早于两者
7. **`state/notes`、`state/sync` slices**（zustand，仅投影）
8. **`features/FileTree`、`features/Editor`（CodeMirror 6）、回收站 `.trash/`、内链跳转** — 全部走 StorageAdapter
9. **`App.tsx` 布局骨架**（桌面双栏 / 移动单栏两档）

**出口**：断网下建/改/删/搜/内链/回收站全可用（M1 前半）。

## 阶段 2 · M1-b 服务端认证（解锁的服务端一半）

10. **`adapters/user_store.py`**（/data 卷用户表）
11. **`core/auth.py`**（register/login/refresh/put_key/delete、HMAC token、按 username 限速）
12. **`api/schemas.py`（auth 部分）→ `api/deps.py` require_user → `api/auth.py`、`api/health.py` → `api/__init__.py` 汇总**
13. **`main.py` 装配**：adapters 构造 → core 注入 → 路由挂载 → 领域错误统一翻译（401/404/409/413/429/507）→ 按 IP 限速中间件 → 静态托管 dist
14. **测试**：`tests/unit/core/`（fake ports）+ `tests/integration/api/`（dependency_overrides）+ `tests/smoke.py` 跑通 `/health`、注册、登录

**出口**：注册/登录/续期/换口令/注销全链路测试通过；错误形状与 API.md §2 一致。

## 阶段 3 · M1-c 客户端加密与登录（M1 出口）

15. **`crypto/envelope.ts`**（NC1 信封、AES-256-GCM、路径确定性 nonce 派生）— 纯函数，先于 keystore 可单测
16. **`crypto/keystore.ts`**（Argon2id WASM → HKDF 分叉 L/KEK → unlock/常驻 MK → REK 导出）— 唯一持密模块
17. **`lib/api.ts` auth 部分 + HTTP→领域错误翻译**
18. **`state/auth` + `features/Login`**（注册即登录、登录即解锁、REK 一次性导出）

**出口（M1）**：断网全部本地功能可用；注册/登录即解锁。

## 阶段 4 · M2 AI 助手中继

19. **服务端**：`adapters/llm_gateway.py` → `adapters/relay_quota.py` → `core/relay.py` → `api/relay.py`（配额 429 + SSE 透传，零留存）
20. **客户端 `ai/tools.ts`**（10 个工具注册表：读 5 + 写 5，只依赖 StorageAdapter + lib/search）
21. **`ai/llmTransport.ts`**（Relay 实现，OpenAI 兼容 SSE；Direct 只留接缝）
22. **`ai/sessionStore.ts`**（IndexedDB 会话持久化）
23. **`ai/agent.ts`**（工具循环 + write-gate 会话内存）+ **`features/Chat`**（assistant-ui LocalRuntime）

**出口（M2）**：key 不出服务端、会话仅存本机、工具全本地执行。

## 阶段 5 · M3 同步 + 零知识

24. **服务端**：`adapters/file_store.py`（`<uid>/` 分片、自管 rev/字节统计、1 MiB/1 GiB 配额）→ `core/sync.py` → `api/sync.py`（manifest/file GET/PUT/DELETE，409/413/507）
25. **客户端 `sync/codec.ts`**（委托 envelope + `hashWire`）— 加密唯一边界
26. **`sync/engine.ts`**（manifest diff、防抖推送、409 → 冲突副本、触发时机）+ **`state/sync` 投影 + `features/StatusBar`**
27. **零知识验收测试**：两客户端互同步，打开 `/notes/<uid>/` 卷无任何明文（含路径）

**出口（M3）**：两客户端经服务端双向同步，冲突产副本；服务端卷看不到明文。

## 阶段 6 · M4 Tauri 桌面

28. `storage/tauriFs.ts`（唯一允许 import `@tauri-apps/*` 的业务文件）→ 壳 `tauri.conf.json`/`capabilities`/`main.rs` → 目录选择 → 三平台安装包

**出口（M4）**：三桌面平台安装包，可编辑本地目录并同步。

## 阶段 7 · M5 响应式 + 移动端

29. 侧滑抽屉、AI 全屏 sheet、≥44px 触控、快捷键平台归一；iOS WKWebView 触控选区实测

**出口（M5）**：真机可用：编辑、同步、chat。

## 阶段 8 · M6 打磨 + 工程化

30. ⌘K 面板、内链补全、状态栏同步指示完善、自动更新；`.github/workflows/` CI（测试 → 镜像释出）；README 快速开始

**出口（M6）**：打磨项齐备，CI 出镜像。

## 关键依赖约束（排序依据）

- **envelope → codec → engine**；**keystore → Login/解锁**；**search → ⌘K 与 AI 工具**（单源不可倒置）
- **服务端认证先行于客户端 Login，但客户端本地功能（阶段 1）不等服务端**——本地优先铁律，也是 M1 的验收点
- 每阶段测试随阶段走：core 单测（fake ports）+ api 集成（dependency_overrides），不留到最后
- `main.py` 是唯一装配点，横切（限速/日志/异常翻译）只在阶段 2/4/5 逐步挂入它，业务模块不自行挂
