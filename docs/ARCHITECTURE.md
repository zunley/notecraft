# notecraft 项目架构

> 本文是仓库的架构落成文档，把设计定稿 [DESIGN.md](DESIGN.md)（决策依据与协议细节以其为准）
> 落地为本仓库的实际结构。
> 一句话定位：**六端本地优先的 Markdown 笔记本——功能主体与 AI Agent 在客户端，
> 服务端只做认证、同步与 LLM 中继，且对笔记内容零知识（只存密文）。**

## 1. 总体架构

```
┌──────────────────────── 客户端（功能主体）────────────────────────┐
│  React UI（六端通用，样式：方案四 · 轻新粗野）                       │
│  ├─ StorageAdapter 存储抽象（本地永远是明文 .md）                    │
│  │    · 桌面/移动（Tauri）：真实 .md 文件（用户目录 / App 沙箱）      │
│  │    · Web（浏览器）：OPFS                                         │
│  ├─ 本地业务：文件树 / 编辑器 / 搜索 / 内链 / 回收站                 │
│  ├─ crypto/：keystore（口令派生与解锁，唯一持密模块）               │
│  │           envelope（内容/路径 AES-256-GCM 加解密）                │
│  ├─ 同步引擎：manifest 拉取、diff、推送、冲突副本                    │
│  │    （进出服务端的每一份数据都经 sync/codec 编解码 = 加密边界）     │
│  ├─ ai/sessionStore：会话历史仅存本机（IndexedDB）                   │
│  └─ AI Agent（前端运行）：                                          │
│       ├─ 工具循环（assistant-ui LocalRuntime）                       │
│       ├─ 文件工具 → 直接操作本地 StorageAdapter（离线可用）           │
│       └─ LlmTransport：Relay（当前）/ Direct（演进预留）             │
└──────────────────────────┬────────────────────────────────────────┘
                           │ HTTPS：认证 + 同步 + LLM 中继
┌──────────────────────────▼────────────────────────────────────────┐
│  服务端（FastAPI，瘦身版，分层 + 端口-适配器）                       │
│  ├─ /api/auth/*       注册 / login（校验登录凭证哈希）/ refresh /   │
│  │                    换口令 / 注销；存取 protected_key（打不开）    │
│  ├─ /api/sync/*       manifest / 文件推拉 / 乐观锁（按 uid 隔离）    │
│  │                    ★ 只见密文：content 与 path 均为密文 blob      │
│  │                    ★ rev 为每用户专属计数器                       │
│  ├─ /api/ai/v1/*      LLM 中继：校验 token → 注入 key → 流式透传     │
│  │                    ★ 零留存：不归档、不记请求体、无会话状态       │
│  ├─ 鉴权依赖 require_user（多租户的唯一切换点）                      │
│  ├─ 配额：存储 / 中继日额 / 注册登录限速（按 uid 或 IP）             │
│  ├─ /health + 可选静态托管 Web 版                                    │
│  └─ 存储：/notes/<uid>/ 密文仓库（卷）；/data 用户表（卷）           │
└─────────────────────────────────────────────────────────────────────┘
```

三条铁律（对应 DESIGN.md §2）：

1. **本地优先**——读写、搜索、内链、AI 工具全部离线可完成；只有「LLM 回复」与「跨设备同步」需要网络。
2. **口令与加密密钥永不进入服务端**——登录凭证在客户端派生，服务端只存其哈希；
   笔记密钥（MK）只存在于客户端内存，服务端持有的 `protected_key` 是一个打不开的信封。
3. **服务端零留存**——中继不归档对话、不记录请求体、不持会话状态；
   同步只存密文；除用户记录与打不开的密钥封装外不保存任何用户数据。

**多租户（服务每一个安装应用的人）**：任何安装者都可注册，每用户一个独立的零知识命名空间
（`/notes/<uid>/` + 专属 rev + 独立配额），用户间互不可见。四个既有接缝使它天然成立：
`require_user` 统一收口、`NoteStore` 全部方法以 `subject` 为首参、零知识模型无跨用户共享秘密、
协议无状态可水平扩展——**加用户不改协议、不改客户端**（接口规格见 [API.md](API.md)）。

**Agent 位置（无歧义版）**：AI Agent **从第一天起就完整运行在客户端**——工具循环、文件工具、
prompt 组装、write-gate、对话上下文管理全在前端；服务端 `/api/ai/v1/*` **自始至终只是透明转发**
（注入 key + 流式透传），不组装 prompt、不执行工具、不持会话状态。
不存在「服务端 Agent 阶段」；将来切 DirectTransport 只换客户端的 Transport 实现，Agent 位置不变。

## 2. 仓库结构

```
notecraft/
├── README.md               # 用户视角说明
├── docs/
│   ├── DESIGN.md           # 设计定稿（原则、协议、安全模型、里程碑）
│   ├── API.md              # 接口唯一权威规格（路径/形状/错误码/限流配额）
│   ├── ARCHITECTURE.md     # 本文：架构落成到仓库结构
│   └── style/              # 样式定稿（mockup + 字体授权）
├── src/
│   ├── client/             # ★ 客户端（功能主体，六端一套代码）
│   │   ├── web/            # React UI
│   │   │   ├── package.json / tsconfig.json / vite.config.ts / index.html
│   │   │   └── src/
│   │   │       ├── main.tsx / App.tsx / theme.css
│   │   │       ├── crypto/    # keystore（派生/解锁/常驻内存）+ envelope（加解密）
│   │   │       ├── storage/   # StorageAdapter 抽象 + TauriFs / OPFS 实现
│   │   │       ├── sync/      # 同步引擎（diff、推送、冲突副本）+ codec.ts（加密边界）
│   │   │       ├── ai/        # llmTransport + tools 注册表 + agent 运行时 + sessionStore
│   │   │       ├── state/     # zustand slices：auth / sync / notes
│   │   │       ├── features/  # FileTree / Editor / Chat / Login / StatusBar
│   │   │       └── lib/       # config（配置单点）/ api（auth/key/sync + 错误翻译）/
│   │   │                       errors（领域错误单源）/ search（搜索唯一实现）/ markdown
│   │   └── tauri/            # Rust 壳（Tauri 2）
│   │       ├── tauri.conf.json / Cargo.toml / build.rs
│   │       ├── capabilities/   # fs 等插件权限声明
│   │       └── src/main.rs
│   └── server/             # ★ 服务端（FastAPI，分层架构见 §4）
│       ├── requirements.txt
│       ├── tests/smoke.py
│       └── app/            # Python 包（导入根，勿拍平：包层避免 types 等顶层名遮蔽标准库）
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
│           │   ├── auth.py / sync.py / relay.py
│           └── adapters/   # ports 实现（可整体替换）
│               ├── file_store.py      # 密文同步副本（按 <uid>/ 分片，自管 rev 与字节统计）
│               ├── user_store.py      # 用户表 + protected_key 存取（/data 卷）
│               ├── llm_gateway.py     # httpx 流式 + key 只存于此
│               └── relay_quota.py     # 中继日配额（本期内存计数）
├── Dockerfile              # 两阶段：node 构建前端 → python 运行时
├── compose.yaml            # /notes + /data 两个卷
├── Makefile                # dev / test / build / up / release
├── .env.example            # 占位符，真实值只在本地 .env（不入库）
└── .github/workflows/      # CI：测试 → 镜像释出（首个 tag 前补齐）
```

## 3. 客户端分层

| 层 | 位置 | 职责 | 关键约定 |
|----|------|------|----------|
| 加密内核 | `crypto/` | keystore：Argon2id 派生、解锁、MK 常驻内存；envelope：无状态 AES-GCM 加解密 | **keystore 唯一持密并驱动 envelope**——envelope 是纯函数（密钥入参出、不落变量），其他代码只调 unlock/encode/decode |
| 存储抽象 | `storage/` | 统一文件读写语义 | 乐观锁 `base_hash`；删除进 `.trash/`；**本地永远明文**（文件即真相） |
| 本地业务 | `features/` + `lib/` | 树/编辑/内链/回收站 | 全部走 StorageAdapter，无任何服务端文件调用 |
| 搜索 | `lib/search.ts` | 全文搜索/内链索引的**唯一实现** | ⌘K 面板与 AI 工具 `search_files` 共用，禁止两处各写一份 |
| 同步引擎 | `sync/` | manifest diff、推拉、冲突处理 | 单文件级 409 → 服务端版本为基线 + 本地另存冲突副本；**content/path 编解码只走 `sync/codec.ts`**——这是加密的唯一边界；同步基线（密文哈希）由 `sync/engine` 自持，`state/sync` 只存投影，勿与本地明文 `base_hash` 混用 |
| AI Agent | `ai/` | 工具循环 + 文件工具注册表 | 工具直接打本地 StorageAdapter；write-gate 仅存当前对话内存 |
| LLM 接入 | `ai/llmTransport.ts` | Relay / Direct 双实现抽象 | 切换实现只改这一个模块 |
| 会话存储 | `ai/sessionStore.ts` | 对话历史 IndexedDB 持久化 | 仅客户端；服务端无任何会话 API |
| 全局状态 | `state/` | zustand slices：auth / sync / notes | 三个切片，不引 Redux/事件总线 |
| 服务端调用 | `lib/api.ts` | 仅 auth / key / sync（JSON）；relay 的 SSE 流式归 `ai/llmTransport.ts` | **HTTP→领域错误的唯一翻译点**；不出现任何文件编辑、搜索、chat 的服务端调用 |
| 领域错误 | `lib/errors.ts` | Conflict / Offline / AuthExpired 等单源 | 与服务端 `errors.py` 对称：api.ts 翻译注入，features 只 catch 领域错误、不接触 status code |
| 平台壳 | `client/tauri/` | 目录选择、fs、托盘、更新 | UI 零分叉，仅存储适配器按平台注入 |

**依赖铁律（客户端，建议 eslint-boundaries / dependency-cruiser 在 CI 强制）**

- `features/*` → 只准 import `state/`、`storage` 接口、`lib/`；不 import `crypto/` 密钥材料、不直接 fetch；
- `state/*` → 不 import `features/`；`ai/tools.ts` → 只依赖 `StorageAdapter` + `lib/search`（不依赖 React/state）；
- `@tauri-apps/*` 只允许出现在 `storage/tauriFs.ts` 与壳层——「UI 零分叉」由此保证；
- 平台差异只经 `StorageAdapter` 注入，功能代码零平台判断。

平台矩阵：Windows/macOS/Linux（Tauri desktop + 用户目录）、iOS/Android（Tauri mobile + 沙箱 Documents）、Web（OPFS，无壳）。

**扩展点**（换实现只动这一处，调用方零改动——DESIGN.md §3.7）：
`crypto/keystore.ts`（设备密钥/生物识别）、`sync/codec.ts`（算法升级）、
`ai/sessionStore.ts`（会话导出/漫游）、`ai/llmTransport.ts`（直连网关）、
`storage/`（新平台）、`ai/tools.ts`（新工具 = 注册表加一项）。

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
- 装配只发生在 `main.py`（composition root）；
- **显式豁免**：`rev` 递增、字节统计与存储配额就近归 `NoteStore` adapter 自管（数据一致性规则不回流 core，避免双头）。

**两条辅助规则**

- **类型与错误各只有一个来源**：契约类型在 `app/types.py`（`api/schemas.py` 只做 HTTP 序列化壳），
  领域错误在 `app/errors.py`（core 抛出，`main.py` 注册异常处理器统一翻译为 401/404/409）；
- **装配不引 DI 容器**：实例挂 `app.state`，api 层用 FastAPI Depends 取用；
  测试用 `dependency_overrides` 注入 fake ports，不 monkeypatch。

**换实现只动 `adapters/` + `main.py`**，core/api 零改动——全部演进切换点因此收口：

| 端口 | 本期实现 | 远期替换（设计出处） |
|------|----------|----------------------|
| `UserStore` | `FileUserStore`（/data 卷：每用户 `hash(L)` + protected_key） | SQLite/Postgres（用户数 ~10³，API.md §8） |
| `NoteStore` | `FileNoteStore`（只存密文 blob，按 `<uid>/` 隔离，自管 rev 与字节统计） | 无需替换——密文即常态；演进只在客户端 envelope |
| `LlmGateway` | `HttpLlmGateway`（中继透传，key 只在其内部） | 直连网关启用后中继整体退役（DESIGN.md §6.7） |
| `RelayQuota` | `MemRelayQuota`（内存日计数，重启清零） | 持久化计数（需精确计费时，API.md §7） |

## 5. 服务端 API

**唯一权威规格：[API.md](API.md)**——路径、请求/响应形状、错误码、限流与配额都在那里；
本节只记与实现相关的要点：

| 分组 | 端点 | 实现落点 |
|------|------|----------|
| 账户 | `GET /api/auth/policy`、`POST register/login/refresh/key`、`DELETE /api/auth/account` | `core/auth.py` + `UserStore`；注册策略与限速见 API.md §7 |
| 同步 | `GET /api/sync/manifest`、`GET/PUT/DELETE /api/sync/file` | `core/sync.py` + `NoteStore`（rev 按 uid 专属） |
| 中继 | `POST /api/ai/v1/chat/completions` | `core/relay.py` + `LlmGateway` + `RelayQuota` |
| 健康 | `GET /health` | 免鉴权 |

- 除 `/health`、`policy`、`register`、`login` 外全部过 `require_user`
  （`api/deps.py`：验签 → 确认用户存在 → 解 `sub` → 挂上下文）——**多租户的唯一切换点**；
- 路径中的 `/v1` 是 OpenAI 兼容约定，与本项目版本无关；
- `hash` 定义为**传输字节（密文）的 sha256**——服务端不需要理解任何明文语义；
- 预留（当前不实现）：`GET /api/ai/config` —— 直连网关时下发网关地址与密钥。

## 6. 关键数据流

**编辑（离线可用）**
`Editor → StorageAdapter.writeFile(path, content, baseHash)` → 本地 hash 比对，不符抛 `ConflictError` → 防抖 ~2s 触发同步推送。

**登录即解锁（DESIGN.md §6.3）**
`新用户：POST /api/auth/register（本地生成 MK，注册即登录）；已有用户：
Login → 本地 Argon2id(口令) → root → HKDF 分叉：L（登录凭证）+ KEK（解密密钥）→
POST /api/auth/login{password: L} → 服务端校验 hash(L) → {token, protected_key} →
KEK 解开 protected_key 得 MK → MK 常驻内存，同步自动解锁`。
换口令走 `PUT /api/auth/key`（只重封装，笔记不动）；注销走 `DELETE /api/auth/account`。

**同步（服务端只见密文）**
拉：`GET manifest` → 解密路径 → 与本地 diff → 逐个 `GET file` → envelope 解密 → 写本地；
推：本地内容与路径经 `sync/codec.ts`（→ `crypto/envelope`）加密 → `PUT file`
（base_hash = 上次同步的密文哈希）→ 200 更新基线 / 409 → 下载服务端版本为基线，
本地内容另存 `笔记 (冲突 YYYYMMDD-HHMM).md` 后正常推送。命名空间按 token `sub`（uid）隔离，`rev` 按用户专属。

**AI 对话（零留存中继）**
`Chat → agent 组装完整 messages + tools + conversation_id → LlmTransport.stream →
POST /api/ai/v1/chat/completions（Bearer=用户 token）→ api → core.relay →
LlmGateway 注入 key → 网关 → 流式回传`。
服务端转发即消失：不归档、不记请求体；对话历史由客户端 `ai/sessionStore` 写入 IndexedDB。
工具调用在客户端本地执行，不经过服务端。

**认证**
register / login → 经 `UserStore` 校验登录凭证哈希 → HMAC-SHA256 token（payload 含 `sub` = uid）→
后续请求 Bearer → `api/deps.py` 验签、确认用户仍存在、解 `sub` 挂上下文（注销即令旧 token 失效）。

## 7. 部署形态

- **服务端**：Docker 单容器（后端 + Web 静态托管），两个卷——
  `/notes`（各用户密文仓库 `<uid>/`，**全部密文**）、`/data`（用户表 + protected_key，
  **必须备份**：丢失即无法登录/解锁，兜底靠用户手里的恢复密钥文件）；
- **桌面**：`tauri build` → nsis / dmg / appimage+deb；
- **移动**：Xcode / Android Studio，CI 需 macOS runner 与签名证书；
- **Web**：`vite build` 静态资源，可由服务端托管。

## 8. 加密落点（写代码时的纪律）

1. **LLM 调用收敛**为 `client/web/src/ai/llmTransport.ts` 单一模块（relay 的 SSE 流式也只在此，`lib/api.ts` 不碰 relay）；
2. **同步编解码只走** `client/web/src/sync/codec.ts`（内部委托 `crypto/envelope.ts`）——
   加密/解密/算法升级都只改这里，manifest 与 API 协议零改动；
   `hash` 一律为传输字节（密文）的哈希，密文哈希天然满足乐观锁一致性；
3. **密钥只活在** `crypto/keystore.ts`——keystore 驱动 envelope（envelope 不持有密钥状态），其他模块不 import 密钥材料，只调用 unlock/encode/decode；
4. **服务端不理解明文**——`NoteStore` 只做 blob 存取与 hash 比对，永远不做内容语义处理。

已知泄露面（DESIGN.md §6.6）：密文大小（已按 4KiB 对齐）与更新频率、路径等值关系、登录元数据。

## 9. 里程碑

唯一权威：[DESIGN.md §8](DESIGN.md)（M1 本地优先+解锁 → M2 AI+中继 → M3 同步+零知识 →
M4 Tauri 桌面 → M5 响应式+移动端 → M6 打磨），本节不复写，避免双写漂移。

## 10. 命名约定与未决项

**命名约定**
- 仓库/产品名：**notecraft**；环境变量前缀：**`NOTE_MD_*`**（实现与文档一致，改前缀需同步 DESIGN.md）；
- 镜像：`ghcr.io/zunley/notecraft`；
- 服务端 Python 包名：**`app`**（`uvicorn app.main:app --app-dir src/server`）；
- Tauri 壳目录：**`src/client/tauri/`**（若 `tauri init` CLI 不支持自定义路径，
  则回退默认 `src-tauri/` 移入 `src/client/`——未决项 1）。

**协议演进约定**
- relay 路径自带 `/v1`（OpenAI 兼容要求，与本项目版本无关）；其余接口破坏性变更时在 `/api` 后加版本段；
- 同步协议版本以 manifest 响应的 `protocol` 字段预留（客户端 `config.syncProtocol` 对应），旧客户端可提示升级；
- 加密信封自带 `NC1` 版本前缀，算法迁移时新旧并行读、逐步回写。

**未决项**（不阻塞开工，见 DESIGN.md §6.7）
1. Rust 壳目录命名最终确认（本仓库暂定 `src/client/tauri/`）；
2. MCP 端点去留（建议后续再议）；
3. iOS 分发方式；
4. `.trash/` 与冲突副本的清理策略；
5. 注册防滥用策略默认值（`NOTE_MD_REGISTRATION` 与限速参数，API.md §7 已列，默认 open）。

## 11. 取舍记录（简单性优先）

原则：**只做「形状级」扩展点（类型、接口、注册表、统一函数），不做框架级抽象**。

**采用（低成本、高收益）**

| 项 | 落点 | 解决什么 |
|----|------|----------|
| 共享契约类型 | `server/app/types.py` | 端口契约可类型检查，改协议只改一处 |
| 领域错误三类 | 服务端 `server/app/errors.py` + main 统一翻译；客户端 `lib/errors.ts` + `lib/api.ts` 统一翻译 | 两侧对称：用例/功能只抛领域错误，HTTP 细节收在一个翻译点 |
| 工具注册表 | `client/web/src/ai/tools.ts`（`ToolSpec[]`） | 加工具 = 加一项声明；write-gate 按 kind 自动挂载 |
| 编解码统一函数 | `client/web/src/sync/codec.ts` | 加密/换算法只改一个文件（§8 纪律 2 落成代码） |
| 唯一持密模块 | `client/web/src/crypto/keystore.ts` | 密钥材料不散落，换解锁方式只改一处 |
| 配置单点 | `client/web/src/lib/config.ts` | 切直连网关的全部改动量就是这里的两个参数 |
| 客户端依赖铁律 + lint | ARCHITECTURE.md §3（eslint-boundaries / dependency-cruiser） | 分层不靠自觉，越界 import 在 CI 即红 |
| 装配形态约定 | `main.py`（app.state + Depends + dependency_overrides） | 可测试性，且不引入 DI 容器 |
| 协议演进约定 | §10 | 版本协商有据可依，不需版本框架 |

**明确不做（及升级触发条件）**

| 不做 | 理由 | 何时再做 |
|------|------|----------|
| DI 容器 / IoC 框架 | 手工装配 + Depends 足够 | 装配重复出现 ~3 处以上 |
| OpenAPI 代码生成 | 双写成本低于引入生成链 | 出现第三方客户端消费 API |
| TokenCodec 端口 | 目前只有一种 token 方案（YAGNI） | 出现第二种方案（如设备绑定/吊销） |
| 横切框架（限速/指标/审计统一框架） | FastAPI 中间件逐个挂即可 | 横切需求 > 3 个且逻辑交叉 |
| 服务端会话归档 | 零知识铁律：会话仅客户端留存 | 不做——这是产品决策，不是技术债 |
| 路由框架 / Redux / 事件总线 | 单页 + zustand 三个 slice 足够 | 出现真实多页面或跨域状态风暴 |
| feature-first 重组 | 当前用例域少，layer-first 更清晰 | 用例域 > 6 或需按 feature 裁剪/发布 |
| 插件化工具加载（动态发现） | 静态注册表已满足现有工具与未来自定义 | 需要第三方工具包 |
