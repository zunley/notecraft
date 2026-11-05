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
│  服务端（FastAPI，瘦身版，分层 + 端口-适配器）                        │
│  ├─ /api/auth/*       username+password → token（含 sub）          │
│  ├─ /api/sync/*       manifest / 文件推拉 / 乐观锁（按 sub 隔离）   │
│  ├─ /api/ai/v1/*      LLM 中继：校验 token → 注入 key → 流式透传    │
│  │                    同时把对话归档到 data/sessions/（无读取 API）  │
│  ├─ 鉴权依赖 require_user（多用户模式的唯一切换点）                   │
│  ├─ /health + 可选静态托管 Web 版                                   │
│  └─ 存储：/notes 笔记本同步副本（卷）；/data 应用数据（卷）           │
└─────────────────────────────────────────────────────────────────────┘
```

三条铁律（对应 DESIGN-V2 决议 V2/V4/V5）：

1. **本地优先**——读写、搜索、内链、AI 工具全部离线可完成；只有「LLM 回复」与「跨设备同步」需要网络。
2. **key 永不下发客户端**——Agent 在客户端，但 LLM 请求经服务端中继（OpenAI 兼容透传）。
3. **会话仅服务端归档**——客户端不请求、不展示、不落任何会话历史；归档无对外 API。

**Agent 位置（无歧义版）**：AI Agent **从第一阶段起就完整运行在客户端**——工具循环、14 个文件工具、
prompt 组装、write-gate、对话上下文管理全在前端；服务端 `/api/ai/v1/*` **自始至终只是透明转发**
（注入 key + 流式透传 + 归档副产品），不组装 prompt、不执行工具、不持会话状态。
不存在「服务端 Agent 阶段」；二期的变化只是 LLM 流量直连网关（DirectTransport），Agent 位置不变。

## 2. 仓库结构

```
notecraft/
├── README.md               # 用户视角说明
├── docs/
│   ├── DESIGN-V2.md        # 设计定稿（决策摘要、协议、里程碑、决议记录）
│   ├── ARCHITECTURE.md     # 本文：架构落成到仓库结构
│   └── style/              # 样式定稿（mockup + 字体授权）
├── src/
│   ├── client/             # ★ 客户端（功能主体，六端一套代码）
│   │   ├── web/            # React UI
│   │   │   ├── package.json / tsconfig.json / vite.config.ts / index.html
│   │   │   └── src/
│   │   │       ├── main.tsx / App.tsx / theme.css
│   │   │       ├── storage/    # StorageAdapter 抽象 + TauriFs / OPFS 实现
│   │   │       ├── sync/       # 同步引擎（diff、推送、冲突副本）+ codec.ts（加密纪律②）
│   │   │       ├── ai/         # llmTransport（纪律①）+ tools 注册表 + agent 运行时
│   │   │       ├── features/   # FileTree / Editor / Chat / Login / StatusBar
│   │   │       └── lib/        # config.ts（配置单点）+ api.ts（仅 auth/sync/relay）+ markdown
│   │   └── tauri/            # Rust 壳（Tauri 2）
│   │       ├── tauri.conf.json / Cargo.toml / build.rs
│   │       ├── capabilities/   # fs 等插件权限声明
│   │       └── src/main.rs
│   └── server/             # ★ 服务端（FastAPI，分层架构见 §4）
│       ├── requirements.txt
│       ├── tests/smoke.py
│       └── app/
│           ├── main.py     # 组装根：构造 adapters → 注入 core → 注册路由/异常翻译
│           ├── config.py   # 环境变量配置（凭证/密钥只在 .env）
│           ├── ports.py    # 接口契约（Protocol）——依赖倒置的接缝
│           ├── types.py    # 共享契约类型（跨层唯一来源）
│           ├── errors.py   # 领域错误（core 抛出，api 统一翻译为 HTTP）
│           ├── api/        # HTTP 薄壳：routes 解析 → 调 core → 响应
│           │   ├── __init__.py   # api_router 汇总
│           │   ├── deps.py       # require_user（唯一切换点）
│           │   ├── schemas.py    # Pydantic 请求/响应
│           │   ├── auth.py / sync.py / relay.py / health.py
│           ├── core/       # 用例层（纯 Python，禁止 import fastapi）
│           │   ├── auth.py / sync.py / relay.py / archive.py
│           └── adapters/   # ports 实现（可整体替换）
│               ├── file_store.py      # 同步副本（原 v1 filesvc 语义）
│               ├── credentials.py     # env 单账号 → 远期用户表
│               ├── llm_gateway.py     # httpx 流式 + key 只存于此
│               └── session_archive.py # data/sessions/ 写入
├── Dockerfile              # 两阶段：node 构建前端 → python 运行时
├── compose.yaml            # /notes + /data 两个卷
├── Makefile                # dev / test / build / up / release
├── .env.example            # 占位符，真实值只在本地 .env（不入库）
└── .github/workflows/      # CI：测试 → 镜像释出（首个 tag 前补齐）
```

> 与 DESIGN-V2 §9 原建议（`src/api` / `src/web` / `src/tauri`）的差异：顶层改为
> **client / server 二分**，原三目录分别移入其下；服务端内部由单层平铺改为四层结构（§4）。
> 模块职责与 DESIGN-V2 §4.3 一一对应，仅归位拆分，无语义变化。

## 3. 客户端分层

| 层 | 位置 | 职责 | 关键约定 |
|----|------|------|----------|
| 存储抽象 | `client/web/src/storage/` | 统一文件读写语义 | 乐观锁 `base_hash`；删除进 `.trash/`；**整个本地优先改造的地基** |
| 本地业务 | `features/` + `lib/` | 树/编辑/搜索/内链/回收站 | v1 的 REST 调用（`/api/files/*`、`/api/search`）全部改走 StorageAdapter |
| 同步引擎 | `sync/` | manifest diff、推拉、冲突处理 | 单文件级 409 → 服务端版本为基线 + 本地另存冲突副本；content 编解码走统一函数（加密留缝②） |
| AI Agent | `ai/` | 工具循环 + 14 个文件工具 | 工具直接打本地 StorageAdapter；write-gate 仅存当前对话内存 |
| LLM 接入 | `ai/llmTransport.ts` | Relay / Direct 双实现抽象 | **加密纪律①**：LLM 调用收敛为单一模块，二期切直连只改这里 |
| 服务端调用 | `lib/api.ts` | 仅 auth / sync / relay | 不再出现任何文件编辑、搜索、chat 的服务端调用 |
| 平台壳 | `client/tauri/` | 目录选择、fs、托盘、更新 | UI 零分叉，仅存储适配器按平台注入 |

平台矩阵：Windows/macOS/Linux（Tauri desktop + 用户目录）、iOS/Android（Tauri mobile + 沙箱 Documents）、Web（OPFS，无壳）。

## 4. 服务端分层（端口-适配器）

```
请求 → ┌──────────┐   ┌──────────────┐   ┌─────────┐
       │  api/    │ → │   core/      │ → │ ports.py│ ← ┌────────────┐
       │ HTTP薄壳 │   │ 用例 + 规则  │   │ Protocol │   │ adapters/  │
       └──────────┘   └──────────────┘   └─────────┘   │ 实现（可换）│
            ↑                                          └────────────┘
       main.py（组装根）：构造 adapters 实例 → 注入 core → 挂 api 路由
```

**依赖规则（铁律）**

- `api/` → `core/`：api 只做解析/校验/响应，不含业务规则，不直接触碰 adapters；
- `core/` → `ports`：core 纯 Python，**禁止 import fastapi**，只依赖 Protocol；
- `adapters/` → `ports`：实现 Protocol；**core 与 api 永不 import adapters**；
- 装配只发生在 `main.py`（composition root）。

**两条辅助规则**

- **类型与错误各只有一个来源**：契约类型在 `app/types.py`（`api/schemas.py` 只做 HTTP 序列化壳），
  领域错误在 `app/errors.py`（core 抛出，`main.py` 注册异常处理器统一翻译为 401/404/409）；
- **装配不引 DI 容器**：实例挂 `app.state`，api 层用 FastAPI Depends 取用；
  测试用 `dependency_overrides` 注入 fake ports，不 monkeypatch。

**换实现只动 `adapters/` + `main.py`**，core/api 零改动——DESIGN-V2 的全部演进切换点因此收口：

| 端口 | 本期实现 | 远期替换（设计出处） |
|------|----------|----------------------|
| `Credentials` | `EnvCredentials`（env 单账号） | 用户表 + 哈希口令（§6.2 ①） |
| `NoteStore` | `FileNoteStore`（明文同步副本） | 加密沙盒：只存密文（§5.6） |
| `LlmGateway` | `HttpLlmGateway`（中继透传，key 只在其内部） | 二期 DirectTransport（§7） |
| `SessionArchive` | `FsSessionArchive`（data/ 卷） | 客户端加密上传 / 仅客户端留存（§7） |

**模块归位对照**（DESIGN-V2 §4.3 → 本仓库）：

| 设计稿模块 | 落地位置 |
|------------|----------|
| `main.py` | `app/main.py`（组装根） |
| `config.py` | `app/config.py` |
| `auth.py` | `api/auth.py`（路由）+ `api/deps.py`（require_user）+ `core/auth.py`（用例）+ `adapters/credentials.py` |
| `sync.py` | `api/sync.py` + `core/sync.py` |
| `relay.py` | `api/relay.py` + `core/relay.py` + `adapters/llm_gateway.py` |
| `filesvc.py` | `adapters/file_store.py`（仅服务同步） |
| `archive.py` | `core/archive.py` + `adapters/session_archive.py` |
| `models.py` | `api/schemas.py` |

## 5. 服务端 API（v2 全量）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | `{username, password}` → `{token, expires_at}` |
| `POST` | `/api/auth/refresh` | 续期（token 内 `sub` 不变） |
| `GET` | `/api/sync/manifest` | `{rev, files:[{path, hash, mtime, size}]}` |
| `GET` | `/api/sync/file?path=` | `{content, hash, mtime}` |
| `PUT` | `/api/sync/file` | `{path, content, base_hash}`；hash 不符 → 409 |
| `POST` | `/api/ai/v1/chat/completions` | LLM **纯转发**：OpenAI 兼容，Bearer 用户 token，注入 key 后透传（含流式），同时归档透传记录。不组装 prompt、不执行工具、不持会话状态 |
| `GET` | `/health` | 免鉴权 |

- 除 `/health` 外全部过 `require_user`（`api/deps.py`：验签 → 解 `sub` → 挂上下文）——**后期多用户的唯一切换点**。
- **已删除**（相对 v1）：`/api/files/*`、`/api/search`、`/api/chat`、`/api/sessions`、`agent.py`、`mcp_server.py`、笔记本内 `.agents/`。
- 预留（本期不实现）：`GET /api/ai/config` —— 二期 DirectTransport 下发网关与密钥。

## 6. 关键数据流

**编辑（离线可用）**
`Editor → StorageAdapter.writeFile(path, content, baseHash)` → 本地 hash 比对，不符抛 `ConflictError` → 防抖 ~2s 触发同步推送。

**同步**
拉：`GET manifest` → 与本地 diff → 逐个 `GET file`；推：`PUT file`（base_hash = 上次同步版本）→ 200 更新基线 / 409 → 下载服务端版本为基线，本地内容另存 `笔记 (冲突 YYYYMMDD-HHMM).md` 后正常推送。命名空间从第一天按 token `sub` 隔离。

**AI 对话**
`Chat → agent 组装完整 messages + tools + conversation_id → LlmTransport.stream → POST /api/ai/v1/chat/completions（Bearer=用户 token）→ api → core.relay → LlmGateway 注入 key → 网关 → 流式回传`；同时 core.relay 触发 SessionArchive 按 conversation_id 归档到 `data/sessions/`（无读取 API）。工具调用在客户端本地执行，不经过服务端。

**认证**
login 双字段 → `core.auth` 经 Credentials 校验 → HMAC-SHA256 token（payload 含 `sub`）→ 后续请求 Bearer → `api/deps.py` 解 `sub` 挂上下文。

## 7. 部署形态

- **服务端**：Docker 单容器（后端 + Web 静态托管），两个卷——`/notes`（笔记本同步副本）、`/data`（sessions 归档，备份策略与 `/notes` 分开，`workflow/backup.sh` 需相应加一条）；
- **桌面**：`tauri build` → nsis / dmg / appimage+deb；
- **移动**：Xcode / Android Studio，CI 需 macOS runner + 签名证书；
- **Web**：`vite build` 静态资源，可由服务端托管。

## 8. 加密留缝（本期不实现，写代码时的三条纪律）

1. LLM 调用收敛为 `client/web/src/ai/llmTransport.ts` 单一模块；
2. 同步 content 编解码只走 `client/web/src/sync/codec.ts`（当前直通）——加密即在 encode/decode 内插入，manifest 与 API 协议零改动；`hash` 定义为传输字节的哈希，密文哈希天然一致；
3. 业务接口不读取服务端文件明文语义（服务端对应物：换 `NoteStore` 加密实现）。

已知泄露面（二期处理）：文件路径明文、manifest 的 mtime/size 旁路信息。

## 9. 里程碑（出口标准详见 DESIGN-V2 §10）

> 注：M2 的「Agent 前移」是 DESIGN-V2 相对 v1 的迁移措辞（v1 的 agent.py 在服务端）。
> **本仓库从第一阶段（M1）起 Agent 就在客户端实现**，不存在服务端 Agent 阶段；
> M2 的服务端部分只是把转发接口建起来（/api/ai/v1/*）。

| # | 名称 | 出口标准 |
|---|------|----------|
| M1 | 本地优先 | 断网下全部本地功能可用 |
| M2 | Agent 前移 + 中继 | AI 全功能在客户端工作，key 不出服务端 |
| M3 | 同步 + 服务端瘦身 | 两客户端经服务端双向同步，冲突产副本 |
| M4 | Tauri 桌面 | 三桌面平台安装包可编辑本地目录并同步 |
| M5 | 响应式 + 移动端 | 真机可用：编辑、同步、chat |
| M6 | 打磨 | 对齐 v1 遗留 P1 清单 |

## 10. 命名约定与未决项

**命名约定**
- 仓库/产品名：**notecraft**；环境变量前缀沿用设计定稿的 **`NOTE_MD_*`**（实现与文档一致，改前缀需同步 DESIGN-V2）；
- 镜像：`ghcr.io/zunley/notecraft`（有意区别于 v1 的 `ghcr.io/zunley/note.md`，两版并行发布、互不打断）；
- 服务端 Python 包名：**`app`**（`uvicorn app.main:app --app-dir src/server`）；
- Tauri 壳目录：**`src/client/tauri/`**（若 `tauri init` CLI 不支持自定义路径，则回退默认 `src-tauri/` 移入 `src/client/`——未决项 1）。

**协议演进约定**
- relay 路径自带 `/v1`（OpenAI 兼容要求）；其余接口破坏性变更时在 `/api` 后加版本段（`/api/v2/...`）；
- 同步协议版本以 manifest 响应的 `protocol` 字段预留（客户端 `config.syncProtocol` 对应），旧客户端可提示升级。

**未决项**（不阻塞开工，见 DESIGN-V2 §11）
1. Rust 壳目录命名最终确认（本仓库暂定 `src/client/tauri/`）；
2. MCP 端点去留（建议 v3 再议）；
3. 会话归档粒度：仅 LLM 往返 or 含客户端工具摘要；
4. iOS 分发方式；
5. `.trash/` 与冲突副本的清理策略。

## 11. 取舍记录（简单性优先）

原则：**只做「形状级」扩展点（类型、接口、注册表、统一函数），不做框架级抽象**。

**采用（低成本、高收益）**

| 项 | 落点 | 解决什么 |
|----|------|----------|
| 共享契约类型 | `server/app/types.py` | 端口契约可类型检查，改协议只改一处 |
| 领域错误三类 | `server/app/errors.py` + main 统一翻译 | 401/404/409 语义有归属，新用例不重复发明错误处理 |
| 工具注册表 | `client/web/src/ai/tools.ts`（ToolSpec[]） | 加工具 = 加一项声明；write-gate 按 kind 自动挂载 |
| 编解码统一函数 | `client/web/src/sync/codec.ts` | E2E 加密只改一个文件（纪律②落成代码） |
| 配置单点 | `client/web/src/lib/config.ts` | 切 DirectTransport 的全部改动量就是这里的两个参数 |
| 装配形态约定 | `main.py`（app.state + Depends + dependency_overrides） | 可测试性，且不引入 DI 容器 |
| 协议演进约定 | §10 | 版本协商有据可依，不需版本框架 |

**明确不做（及升级触发条件）**

| 不做 | 理由 | 何时再做 |
|------|------|----------|
| DI 容器 / IoC 框架 | 手工装配 + Depends 足够 | 装配重复出现 ~3 处以上 |
| OpenAPI 代码生成 | 双写成本低于引入生成链 | 出现第三方客户端消费 API |
| TokenCodec 端口 | 目前只有一种 token 方案（YAGNI） | 出现第二种方案（如 §6.2 ④ 吊销/设备绑定） |
| 横切框架（限速/指标/审计统一框架） | FastAPI 中间件逐个挂即可 | 横切需求 > 3 个且逻辑交叉 |
| feature-first 重组 | 当前用例域少，layer-first 更清晰 | 用例域 > 6 或需按 feature 裁剪/发布 |
| 插件化工具加载（动态发现） | 静态注册表已满足 14 工具与未来自定义 | 需要第三方工具包 |
