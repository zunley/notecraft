# notecraft 项目架构

> 本文把设计定稿 [DESIGN.md](DESIGN.md) 落地为本仓库的实际结构。
> 一句话定位：**六端本地优先的 Markdown 笔记本——功能主体与 AI Agent 在客户端，
> 服务端只做认证、同步与 LLM 中继，且对笔记内容零知识（只存密文）。**
> 接口规格的唯一权威是 [API.md](API.md)。

## 1. 总体架构

```
┌──────────────────────── 客户端（功能主体）────────────────────────┐
│  React UI（六端通用，样式：方案四 · 轻新粗野）                       │
│  ├─ StorageAdapter 存储抽象（本地永远是明文 .md）                    │
│  │    · 桌面/移动（Tauri）：真实 .md 文件；Web：OPFS                │
│  ├─ 本地业务：文件树 / 编辑器 / 搜索 / 内链 / 回收站                 │
│  ├─ crypto/：keystore（口令派生与解锁，唯一持密）+ envelope（加解密） │
│  ├─ 同步引擎：manifest diff、推送、冲突副本                          │
│  │    （进出服务端的每一份数据都经 sync/codec 编解码 = 加密边界）     │
│  ├─ ai/sessionStore：会话历史仅存本机（IndexedDB）                   │
│  └─ AI Agent（前端运行）：工具循环 + 文件工具（打本地存储，离线可用）  │
│       LlmTransport：Relay（当前）/ Direct（演进预留）                │
└──────────────────────────┬────────────────────────────────────────┘
                           │ HTTPS：认证 + 同步 + LLM 中继
┌──────────────────────────▼────────────────────────────────────────┐
│  服务端（FastAPI，分层 + 端口-适配器，纯 API）                       │
│  ├─ /api/auth/*       注册 / login / refresh / 换口令 / 注销；      │
│  │                    存取 protected_key（打不开）                  │
│  ├─ /api/sync/*       manifest / 文件推拉 / 乐观锁（按 uid 隔离）    │
│  │                    ★ 只见密文：content 与 path 均为密文 blob     │
│  │                    ★ rev 为每用户专属计数器                      │
│  ├─ /api/ai/v1/*      LLM 中继：校验 token → 注入 key → 流式透传     │
│  │                    ★ 零留存：不归档、不记请求体、无会话状态       │
│  ├─ 鉴权依赖 require_user（多租户的唯一切换点）                      │
│  ├─ 配额：存储 / 中继日额 / 注册登录限速（按 uid 或 IP）             │
│  └─ 存储：/notes/<uid>/ 密文仓库（卷）；/data 用户表（卷）           │
└─────────────────────────────────────────────────────────────────────┘
```

三条铁律（DESIGN.md §2）：**本地优先**；**口令与加密密钥永不进入服务端**（服务端只存
`hash(L)` 与打不开的 `protected_key`）；**服务端零留存**（中继不归档、同步只存密文）。

**多租户**：任何安装者都可注册，每用户一个独立零知识命名空间（`/notes/<uid>/` + 专属 rev +
独立配额），用户间互不可见。四个既有接缝使它天然成立：`require_user` 统一收口、
`NoteStore` 全部方法以 `subject` 为首参、零知识模型无跨用户共享秘密、协议无状态可水平扩展
——**加用户不改协议、不改客户端**。

**Agent 位置**：AI Agent 从第一天起 100% 运行在客户端（工具循环、prompt 组装、write-gate、
上下文管理）；服务端 `/api/ai/v1/*` 自始至终只是透明转发，不组装 prompt、不执行工具、
不持会话状态。

## 2. 仓库结构

```
notecraft/
├── README.md               # 用户视角说明
├── docs/                   # DESIGN（定稿）/ API（接口权威）/ ARCHITECTURE（本文）/ CODE_ORDER（实施记录）/ style/
├── src/
│   ├── client/
│   │   ├── web/            # ★ React UI（六端一套代码）
│   │   │   └── src/
│   │   │       ├── main.tsx / App.tsx / theme.css
│   │   │       ├── crypto/    # keystore（唯一持密）+ envelope（加解密）
│   │   │       ├── storage/   # StorageAdapter：TauriFs / OPFS + 平台工厂
│   │   │       ├── sync/      # 同步引擎 + codec.ts（加密唯一边界）
│   │   │       ├── ai/        # agent / tools 注册表 / llmTransport / sessionStore
│   │   │       ├── state/     # zustand 三切片：auth / sync / notes
│   │   │       ├── features/  # FileTree / Editor / Chat / Login / StatusBar / CommandPalette
│   │   │       └── lib/       # config / api / errors / search / markdown / hash
│   │   └── tauri/            # Rust 壳（Tauri 2）：conf / capabilities / main.rs / icons
│   └── server/             # ★ 服务端（FastAPI 分层，见 §4）
│       ├── requirements.txt / requirements-dev.txt / pytest.ini
│       ├── tests/          # unit（core/adapters + 架构铁律）/ integration / smoke.py
│       └── app/
│           ├── main.py     # 组装根：adapters → core → 路由/异常翻译/横切
│           ├── config.py   # 环境变量配置（NOTE_MD_*，凭证只在 .env）
│           ├── ports.py    # 接口契约（Protocol）——依赖倒置的接缝
│           ├── types.py    # 共享契约类型（跨层唯一来源）
│           ├── errors.py   # 领域错误（core 抛出，main.py 统一翻译）
│           ├── api/        # HTTP 薄壳：deps(require_user) / schemas / auth / sync / relay / health
│           ├── core/       # 用例层（纯 Python，禁止 import fastapi）：auth / sync / relay
│           └── adapters/   # ports 实现：file_store / user_store / llm_gateway / relay_quota
├── Dockerfile              # 服务端镜像（纯 API）
├── Dockerfile.web          # Web 客户端镜像（nginx 静态 + 同源代理）
├── docker-entrypoint.sh    # 容器降权入口（校正卷属主后 setpriv）
├── compose.yaml            # 完全分容器编排：web + server 两服务
├── scripts/                # check_doc_refs.py：文档章节引用校验（防裁剪打断代码注释引用）
├── Makefile                # dev / test / build / up / tauri-* / release
├── .env.example            # 占位符，真实值只在本地 .env（不入库）
└── .github/workflows/ci.yml # CI：测试 → 双镜像释出
```

## 3. 客户端分层

| 层 | 位置 | 关键约定 |
|----|------|----------|
| 加密内核 | `crypto/` | **keystore 唯一持密并驱动 envelope**——envelope 是纯函数，其他代码只调 unlock/encode/decode |
| 存储抽象 | `storage/` | 乐观锁 `base_hash`；删除进 `.trash/`；**本地永远明文**（文件即真相） |
| 搜索 | `lib/search.ts` | 全文搜索/内链索引的**唯一实现**：⌘K 与 AI 工具 `search_files` 共用 |
| 同步引擎 | `sync/` | 单文件 409 → 服务端版本为基线 + 本地另存冲突副本；**content/path 编解码只走 `sync/codec.ts`**；同步基线（密文哈希）由 engine 自持，`state/sync` 只存投影 |
| AI Agent | `ai/` | 工具注册表驱动工具循环与 write-gate；工具直接打本地 StorageAdapter |
| LLM 接入 | `ai/llmTransport.ts` | Relay / Direct 双实现，切换只改这一个模块 |
| 会话存储 | `ai/sessionStore.ts` | 仅客户端 IndexedDB；服务端无任何会话 API |
| 全局状态 | `state/` | zustand 三切片（auth/sync/notes），不引 Redux/事件总线 |
| 服务端调用 | `lib/api.ts` | 仅 auth/key/sync；**HTTP→领域错误唯一翻译点**；relay 流式归 `llmTransport.ts` |
| 领域错误 | `lib/errors.ts` | 与服务端 `errors.py` 对称；features 只 catch 领域错误 |
| 平台壳 | `client/tauri/` | UI 零分叉，平台差异只经 `StorageAdapter` 注入 |

**依赖铁律（建议 dependency-cruiser 在 CI 强制，已配置）**

- `features/*` → 只准 import `state/`、storage 接口、`lib/`、`ai/`（Chat 是 AI 的 UI）；
  **不 import `crypto/` 密钥材料、不直接 fetch**；
- `state/*` → 不 import `features/`；`ai/tools.ts` → 只依赖 `StorageAdapter` + `lib/search`；
- `@tauri-apps/*` 只允许出现在 `storage/tauriFs.ts` 与壳层；
- Python 侧对称铁律由 `tests/unit/test_architecture.py`（AST）强制：
  core 禁 import fastapi、api/adapters 之外禁 import adapters、装配只在 `main.py`。

**扩展点**（换实现只动这一处）：`crypto/keystore.ts`、`sync/codec.ts`、`ai/sessionStore.ts`、
`ai/llmTransport.ts`、`storage/`、`ai/tools.ts`（新工具 = 注册表加一项）。

**平台矩阵**：Windows/macOS/Linux（Tauri desktop）、iOS/Android（Tauri mobile）、Web（OPFS，无壳）。

## 4. 服务端分层（端口-适配器）

```
请求 → ┌──────────┐   ┌──────────────┐   ┌─────────┐
       │  api/    │ → │   core/      │ → │ ports.py│ ← ┌────────────┐
       │ HTTP薄壳 │   │ 用例 + 规则  │   │ Protocol │   │ adapters/  │
       └──────────┘   └──────────────┘   └─────────┘   │ 实现（可换）│
            ↑                                          └────────────┘
       main.py（组装根）：构造 adapters → 注入 core → 挂 api 路由
```

**依赖铁律**：`api/` → `core/`（不含业务规则、不触碰 adapters）；`core/` → `ports`
（**禁止 import fastapi**）；`adapters/` → `ports`；**core 与 api 永不 import adapters**；
装配只发生在 `main.py`。
**豁免**：`rev` 递增、字节统计与存储配额就近归 `NoteStore` 自管（避免双头）。
**辅助规则**：契约类型只在 `types.py`、领域错误只在 `errors.py`（`main.py` 统一翻译为
401/404/409/413/429/503/507）；装配不引 DI 容器——实例挂 `app.state`，测试用
`dependency_overrides` 注入 fake ports。

| 端口 | 本期实现 | 远期替换 |
|------|----------|----------|
| `UserStore` | `FileUserStore`（/data 卷，每用户 `hash(L)` + protected_key） | SQLite/Postgres（~10³ 用户） |
| `NoteStore` | `FileNoteStore`（只存密文 blob，`<uid>/` 隔离，自管 rev 与字节统计） | 无需替换——密文即常态 |
| `LlmGateway` | `HttpLlmGateway`（中继透传，key 只在其内部） | 直连网关启用后中继退役 |
| `RelayQuota` | `MemRelayQuota`（内存日计数，重启清零） | 持久化计数（需精确计费时） |

**换实现只动 `adapters/` + `main.py`**，core/api 零改动。

## 5. 服务端 API

唯一权威规格：[API.md](API.md)。实现落点：

| 分组 | 端点 | 实现落点 |
|------|------|----------|
| 账户 | `GET /api/auth/policy`、`POST register/login/refresh/key`、`DELETE /api/auth/account` | `core/auth.py` + `UserStore` |
| 同步 | `GET /api/sync/manifest`、`GET/PUT/DELETE /api/sync/file` | `core/sync.py` + `NoteStore`（rev 按 uid 专属） |
| 中继 | `POST /api/ai/v1/chat/completions` | `core/relay.py` + `LlmGateway` + `RelayQuota` |
| 健康 | `GET /health` | 免鉴权 |

- 除 `/health`、`policy`、`register`、`login` 外全部过 `require_user`
  （`api/deps.py`：验签 → 确认用户存在 → 解 `sub` → 挂上下文）；
- `hash` = **传输字节（密文）的 sha256**；路径中的 `/v1` 是 OpenAI 兼容约定，与本项目版本无关。

## 6. 关键数据流

- **编辑（离线）**：`Editor → writeFile(path, content, baseHash)` → 本地 hash 比对，不符抛
  `ConflictError` → 防抖保存 + 防抖推送（~2s）。
- **登录即解锁**：本地 `Argon2id(口令) → root → HKDF 分叉 L（登录凭证）+ KEK` →
  `login{password: L}` → 服务端校验 `hash(L)` → `{token, protected_key}` →
  `KEK` 解封 `protected_key` 得 `MK` 常驻内存。换口令只重封装信封（`PUT /api/auth/key`），
  注销删用户记录 + 全部密文（token 即时失效）。
- **同步（只见密文）**：拉 `manifest → 解密路径 → diff → 逐个 GET → 写本地`；
  推 `本地内容经 sync/codec 加密 → PUT（base_hash = 上次密文哈希）`；409 → 下载服务端版本
  为基线 + 本地另存冲突副本。命名空间按 token `sub`，`rev` 按用户专属。
- **AI 对话（零留存中继）**：Chat → agent 组装完整 messages + tools → `LlmTransport.stream`
  → `POST /api/ai/v1/chat/completions` → core 配额准入 → `LlmGateway` 注入 key → 流式回传。
  工具调用在客户端本地执行；会话历史由 `sessionStore` 写入 IndexedDB。
- **认证**：HMAC-SHA256 token（payload `{sub: uid}`）；`require_user` 验签 + 确认用户仍存在
  ——注销即令全部旧 token 失效。

## 7. 部署形态

- **完全分容器（唯一形态）**：API 极简稳定、前端高频发版——服务端镜像**不内嵌静态托管**：
  - **Web 客户端**：`Dockerfile.web` → `ghcr.io/zunley/notecraft`（nginx 静态 +
    同源代理 `/api`、`/health` → 服务端），用户唯一入口 :8080（`NOTE_MD_WEB_PORT`）；
  - **服务端**：`Dockerfile` → `ghcr.io/zunley/notecraft-server`（纯 API），
    :8081（`NOTE_MD_PORT`，桌面端同步 / 直连客户端用）；
  - `compose.yaml` 一键编排两服务；浏览器视角**单源**——用户零配置、免 CORS；
- **服务端数据**：两个卷——`/notes`（各用户密文仓库 `<uid>/`，全部密文）、
  `/data`（用户表 + protected_key，**必须备份**，兜底靠用户手里的恢复密钥文件）；
- **桌面**：`tauri build` → nsis / dmg / appimage+deb（`make tauri-build`）；
- **移动**：Xcode / Android Studio，CI 需 macOS runner 与签名证书；
- **用户约束（不可违反）**：零基础用户只面对「不登录可用」与「注册/登录后同步」，
  界面不出现服务器地址等任何配置项——服务端地址属**部署者层面**（同源代理下不存在该值；
  跨源直连经运行时注入 + `NOTE_MD_ALLOWED_ORIGINS`，不对用户暴露）；
  AI 走服务端中继（key 在服务端），不做 BYOK/浏览器内推理；
- **纯静态降级**：`dist/` 可直接丢任意静态托管（无服务端也能本地用）。

## 8. 加密落点（写代码时的纪律）

1. **LLM 调用收敛**为 `ai/llmTransport.ts` 单一模块（relay 的 SSE 流式也只在此，`lib/api.ts` 不碰 relay）；
2. **同步编解码只走 `sync/codec.ts`**（内部委托 `crypto/envelope.ts`）——算法升级只改这里；
   `hash` 一律为传输字节（密文）的哈希；
3. **密钥只活在 `crypto/keystore.ts`**——其他模块不 import 密钥材料，只调 unlock/encode/decode；
4. **服务端不理解明文**——`NoteStore` 只做 blob 存取与 hash 比对。

已知泄露面见 DESIGN.md §6.6：密文大小（4KiB 对齐）与更新频率、路径等值关系、登录元数据。

## 9. 里程碑

唯一权威：[DESIGN.md §8](DESIGN.md)（M1 本地优先+解锁 → M2 AI+中继 → M3 同步+零知识 →
M4 Tauri 桌面 → M5 响应式+移动端 → M6 打磨）。

## 10. 命名约定与协议演进

**命名约定**
- 仓库/产品名：**notecraft**；环境变量前缀：**`NOTE_MD_*`**；
- 镜像（用户优先：主名给用户直接使用的 Web 版）：`ghcr.io/zunley/notecraft`（Web 客户端）、
  `ghcr.io/zunley/notecraft-server`（服务端，纯 API）；
- 服务端 Python 包名：**`app`**（`uvicorn app.main:create_app --factory --app-dir src/server`）；
- Tauri 壳目录：`src/client/tauri/`（未决项 1）。

**协议演进约定**
- relay 路径自带 `/v1`（OpenAI 兼容要求，与本项目版本无关）；其余接口破坏性变更时在 `/api` 后加版本段；
- 同步协议以 manifest 的 `protocol` 字段协商（客户端 `config.syncProtocol` 对应），旧客户端提示升级；
- 加密信封自带 `NC1` 版本前缀，算法迁移时新旧并行读、逐步回写。

**未决项**（不阻塞开工）：1. Rust 壳目录命名最终确认；2. MCP 端点去留（建议后续再议）；
3. iOS 分发方式；4. `.trash/` 与冲突副本清理策略；5. 注册防滥用策略默认值（`NOTE_MD_REGISTRATION`
与限速参数，API.md §7 已列）；6. 自动更新签名密钥；7. 移动端出包与 iOS WKWebView 触控实测。
