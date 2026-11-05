# notecraft 项目架构

> 本文是仓库的架构落成文档，由设计定稿 [DESIGN-V2.md](DESIGN-V2.md)（决策依据与协议细节以其为准）落地为本仓库的实际结构。
> 一句话定位：**六端本地优先的 Markdown 笔记本——功能主体与 AI Agent 在客户端，服务端只做认证、同步与 LLM 中继。**

## 1. 总体架构

```
┌──────────────────────── 客户端（功能主体）────────────────────────┐
│  React UI（六端通用，样式：方案四 · 轻新粗野）                       │
│  ├─ StorageAdapter 存储抽象                                       │
│  │    · 桌面/移动（Tauri）：真实 .md 文件（用户目录 / App 沙箱）      │
│  │    · Web（浏览器）：OPFS                                        │
│  ├─ 本地业务：文件树 / 编辑器 / 搜索 / 内链 / 回收站                 │
│  ├─ 同步引擎：manifest 拉取、diff、推送、冲突副本                    │
│  └─ AI Agent（前端运行）：                                          │
│       ├─ 工具循环（assistant-ui LocalRuntime）                      │
│       ├─ 文件工具 → 直接操作本地 StorageAdapter（离线可用）          │
│       └─ LlmTransport：RelayTransport（本期）/ Direct（二期预留）    │
└──────────────────────────┬────────────────────────────────────────┘
                           │  HTTPS：认证 + 同步 + LLM 中继
┌──────────────────────────▼────────────────────────────────────────┐
│  服务端（FastAPI，瘦身版）                                          │
│  ├─ /api/auth/*       username+password → token（含 sub）          │
│  ├─ /api/sync/*       manifest / 文件推拉 / 乐观锁（按 sub 隔离）   │
│  ├─ /api/ai/v1/*      LLM 中继：校验 token → 注入 key → 流式透传    │
│  │                    同时把对话归档到 data/sessions/（无读取 API）  │
│  ├─ 鉴权中间件 require_user（多用户模式的唯一切换点）                 │
│  ├─ filesvc / sync    内部模块：维护服务端同步副本                   │
│  ├─ /health + 可选静态托管 Web 版                                   │
│  └─ 存储：/notes 笔记本同步副本（卷）；/data 应用数据（卷）           │
└─────────────────────────────────────────────────────────────────────┘
```

三条铁律（对应 DESIGN-V2 决议 V2/V4/V5）：

1. **本地优先**——读写、搜索、内链、AI 工具全部离线可完成；只有「LLM 回复」与「跨设备同步」需要网络。
2. **key 永不下发客户端**——Agent 在客户端，但 LLM 请求经服务端中继（OpenAI 兼容透传）。
3. **会话仅服务端归档**——客户端不请求、不展示、不落任何会话历史；归档无对外 API。

## 2. 仓库结构

```
notecraft/
├── README.md               # 用户视角说明
├── docs/
│   ├── DESIGN-V2.md        # 设计定稿（决策摘要、协议、里程碑、决议记录）
│   ├── ARCHITECTURE.md     # 本文：架构落成到仓库结构
│   └── style/              # 样式定稿（mockup + 字体授权）
├── src/
│   ├── api/                # Python 后端
│   │   ├── requirements.txt
│   │   ├── app/
│   │   │   ├── main.py     # FastAPI 入口：路由 + 中间件 + 静态托管
│   │   │   ├── config.py   # 环境变量配置（凭证/密钥只在 .env）
│   │   │   ├── auth.py     # 登录、token（含 sub）、require_user 中间件
│   │   │   ├── sync.py     # 同步协议：manifest / 推拉 / rev / 乐观锁
│   │   │   ├── relay.py    # LLM 中继（httpx 流式透传 + 归档触发）
│   │   │   ├── filesvc.py  # 服务端同步副本操作（内部模块）
│   │   │   ├── archive.py  # 会话归档 → DATA_DIR/sessions/（无对外 API）
│   │   │   └── models.py   # Pydantic 模型
│   │   └── tests/smoke.py  # 后端冒烟测试
│   ├── web/                # React 前端（六端 UI）
│   │   ├── package.json / tsconfig.json / vite.config.ts / index.html
│   │   └── src/
│   │       ├── main.tsx / App.tsx / theme.css
│   │       ├── storage/    # ★ StorageAdapter 抽象 + TauriFs / OPFS 实现
│   │       ├── sync/       # 同步引擎（diff、推送、冲突副本）
│   │       ├── ai/         # llmTransport（加密纪律①）+ tools + agent 运行时
│   │       ├── features/   # FileTree / Editor / Chat / Login / StatusBar
│   │       └── lib/        # api.ts（仅 auth/sync/relay）+ markdown 工具
│   └── tauri/              # Rust 壳（Tauri 2）
│       ├── tauri.conf.json / Cargo.toml / build.rs
│       ├── capabilities/   # fs 等插件权限声明
│       └── src/main.rs
├── Dockerfile              # 两阶段：node 构建前端 → python 运行时
├── compose.yaml            # /notes + /data 两个卷
├── Makefile                # dev / test / build / up / release
├── .env.example            # 占位符，真实值只在本地 .env（不入库）
└── .github/workflows/      # CI：测试 → 镜像释出（首个 tag 前补齐）
```

## 3. 前端分层

| 层 | 位置 | 职责 | 关键约定 |
|----|------|------|----------|
| 存储抽象 | `storage/` | 统一文件读写语义 | 乐观锁 `base_hash`；删除进 `.trash/`；**整个本地优先改造的地基** |
| 本地业务 | `features/` + `lib/` | 树/编辑/搜索/内链/回收站 | v1 的 REST 调用（`/api/files/*`、`/api/search`）全部改走 StorageAdapter |
| 同步引擎 | `sync/` | manifest diff、推拉、冲突处理 | 单文件级 409 → 服务端版本为基线 + 本地另存冲突副本；content 编解码走统一函数（加密留缝②） |
| AI Agent | `ai/` | 工具循环 + 14 个文件工具 | 工具直接打本地 StorageAdapter；write-gate 仅存当前对话内存 |
| LLM 接入 | `ai/llmTransport.ts` | Relay / Direct 双实现抽象 | **加密纪律①**：LLM 调用收敛为单一模块，二期切直连只改这里 |
| 服务端调用 | `lib/api.ts` | 仅 auth / sync / relay | 不再出现任何文件编辑、搜索、chat 的服务端调用 |
| 平台壳 | `src/tauri/` | 目录选择、fs、托盘、更新 | UI 零分叉，仅存储适配器按平台注入 |

平台矩阵：Windows/macOS/Linux（Tauri desktop + 用户目录）、iOS/Android（Tauri mobile + 沙箱 Documents）、Web（OPFS，无壳）。

## 4. 服务端 API（v2 全量）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | `{username, password}` → `{token, expires_at}` |
| `POST` | `/api/auth/refresh` | 续期（token 内 `sub` 不变） |
| `GET` | `/api/sync/manifest` | `{rev, files:[{path, hash, mtime, size}]}` |
| `GET` | `/api/sync/file?path=` | `{content, hash, mtime}` |
| `PUT` | `/api/sync/file` | `{path, content, base_hash}`；hash 不符 → 409 |
| `POST` | `/api/ai/v1/chat/completions` | LLM 中继：OpenAI 兼容，Bearer 用户 token，服务端注入 key 后透传（含流式），同时归档对话 |
| `GET` | `/health` | 免鉴权 |

- 除 `/health` 外全部过 `require_user` 中间件（验签 → 解 `sub` → 挂上下文）——**后期多用户的唯一切换点**。
- **已删除**（相对 v1）：`/api/files/*`、`/api/search`、`/api/chat`、`/api/sessions`、`agent.py`、`mcp_server.py`、笔记本内 `.agents/`。
- 预留（本期不实现）：`GET /api/ai/config` —— 二期 DirectTransport 下发网关与密钥。

## 5. 关键数据流

**编辑（离线可用）**
`Editor → StorageAdapter.writeFile(path, content, baseHash)` → 本地 hash 比对，不符抛 `ConflictError` → 防抖 ~2s 触发同步推送。

**同步**
拉：`GET manifest` → 与本地 diff → 逐个 `GET file`；推：`PUT file`（base_hash = 上次同步版本）→ 200 更新基线 / 409 → 下载服务端版本为基线，本地内容另存 `笔记 (冲突 YYYYMMDD-HHMM).md` 后正常推送。命名空间从第一天按 token `sub` 隔离。

**AI 对话**
`Chat → agent 组装完整 messages + tools + conversation_id → LlmTransport.stream → POST /api/ai/v1/chat/completions（Bearer=用户 token）→ 服务端注入 key → 网关 → 流式回传`；同时服务端按 conversation_id 归档到 `data/sessions/`（无读取 API）。工具调用在客户端本地执行，不经过服务端。

**认证**
login 双字段 → HMAC-SHA256 token（payload 含 `sub`）→ 后续请求 Bearer → 中间件解 `sub` 挂上下文。

## 6. 部署形态

- **服务端**：Docker 单容器（后端 + Web 静态托管），两个卷——`/notes`（笔记本同步副本）、`/data`（sessions 归档，备份策略与 `/notes` 分开，`workflow/backup.sh` 需相应加一条）；
- **桌面**：`tauri build` → nsis / dmg / appimage+deb；
- **移动**：Xcode / Android Studio，CI 需 macOS runner + 签名证书；
- **Web**：`vite build` 静态资源，可由服务端托管。

## 7. 加密留缝（本期不实现，写代码时的三条纪律）

1. LLM 调用收敛为 `ai/llmTransport.ts` 单一模块；
2. 同步 content 编解码走统一函数（当前直通）——加密即插 `CipherAdapter`（StorageAdapter ↔ 传输之间），manifest 与 API 协议零改动；`hash` 定义为传输字节的哈希，密文哈希天然一致；
3. 业务接口不读取服务端文件明文语义。

已知泄露面（二期处理）：文件路径明文、manifest 的 mtime/size 旁路信息。

## 8. 里程碑（出口标准详见 DESIGN-V2 §10）

| # | 名称 | 出口标准 |
|---|------|----------|
| M1 | 本地优先 | 断网下全部本地功能可用 |
| M2 | Agent 前移 + 中继 | AI 全功能在客户端工作，key 不出服务端 |
| M3 | 同步 + 服务端瘦身 | 两客户端经服务端双向同步，冲突产副本 |
| M4 | Tauri 桌面 | 三桌面平台安装包可编辑本地目录并同步 |
| M5 | 响应式 + 移动端 | 真机可用：编辑、同步、chat |
| M6 | 打磨 | 对齐 v1 遗留 P1 清单 |

## 9. 命名约定与未决项

**命名约定**
- 仓库/产品名：**notecraft**；环境变量前缀沿用设计定稿的 **`NOTE_MD_*`**（实现与文档一致，改前缀需同步 DESIGN-V2）；
- 镜像：`ghcr.io/zunley/notecraft`（有意区别于 v1 的 `ghcr.io/zunley/note.md`，两版并行发布、互不打断）；
- Tauri 壳目录：**`src/tauri/`**（按 DESIGN-V2 §9 建议；若 `tauri init` CLI 不支持自定义路径，则回退默认 `src-tauri/`——未决项 1）。

**未决项**（不阻塞开工，见 DESIGN-V2 §11）
1. Rust 壳目录命名最终确认（本仓库暂定 `src/tauri/`）；
2. MCP 端点去留（建议 v3 再议）；
3. 会话归档粒度：仅 LLM 往返 or 含客户端工具摘要；
4. iOS 分发方式；
5. `.trash/` 与冲突副本的清理策略。
