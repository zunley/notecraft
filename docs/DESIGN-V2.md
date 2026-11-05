# note.md v2 设计文档 — 跨平台独立应用 · 本地优先 · 同步服务

> 状态：**定稿（2025-11，第三轮修订）**，供新仓库开工使用。本文档自包含，可整体带走到新目录。
> 一句话定位：**一个跑在 Windows / Linux / macOS / iOS / Android / Web 六端的本地优先 Markdown 笔记本，
> 功能主体与 AI Agent 在客户端，服务端只保留同步、认证与 LLM 中继，
> 会话记录仅服务端归档、不对客户端呈现；端到端加密与多用户沙盒作为演进方向预留架构接口。**
>
> v1 参考实现与样式资产见原仓库 `docs/PRODUCT.md`、`docs/DEV.md`、`docs/style/`、`src/web/src/theme.css`。

---

## 1. 决策摘要

| # | 决策 | 说明 |
|---|------|------|
| D1 | 客户端 = **Tauri 2 + 现有 React/Vite UI** | 一套代码打包六端，不重写 UI |
| D2 | **本地优先**：业务功能全部在客户端 | 树/编辑/搜索/内链/回收站直接操作本地存储，离线可用 |
| D3 | **AI Agent 运行在客户端** | 工具循环 + 14 个文件工具全部打本地 StorageAdapter，离线也能用 AI 整理笔记 |
| D4 | **LLM 请求走服务端中继** | 客户端 Agent 不直连外部大模型；服务端校验用户 token → 注入 LLM key → 转发网关 → 流式回传；**key 永不下发客户端** |
| D5 | 服务端职责 = **认证 + 同步 + LLM 中继（+ 会话归档）** | 不再提供文件编辑 REST、搜索、Agent 运行时 |
| D6 | 会话记录**仅服务端归档**，客户端不呈现 | 客户端只做消息封装（每次请求发完整 messages 数组）；无会话历史 API/UI，不落客户端存储 |
| D7 | 登录 = **username + password → token**，token 携带用户身份（`sub`） | 全部接口过鉴权中间件；为后期服务端多用户模式铺路（见 §6） |
| D8 | 同步与消息的**端到端加密第一阶段不做**，架构留缝 | 加密只需在客户端编解码层插入，协议不改（见 §5.6、§7） |
| D9 | 同步协议 v1 = **manifest + hash + 乐观锁 + 冲突副本** | 简单可靠；git-backed 同步（版本历史）留作后续可选项 |

**修订记录**：
- R1（第一轮）：AI 会话从笔记本 `.agents/sessions/` 剥离——笔记本只放用户笔记（D6）。
- R2（第二轮）：**Agent 回到客户端**（撤回「服务端 Agent」方案），但 LLM 请求**经服务端中继**而非直连外部模型（D3/D4）——
  同时满足「Agent 在客户端」与「key 不出服务端」。
- R3（第二轮）：认证从单口令升级为 **username + password**，token 携带身份，预留多用户中间件与 per-user 加密沙盒（D7）。
- R4（第二轮）：E2E 加密（同步 + 消息）确认为第二阶段目标，本期只留接口缝（D8，见 §7）。

---

## 2. 总体架构

```
┌──────────────────────── 客户端（功能主体）────────────────────────┐
│  React UI（六端通用，样式沿用「方案四 · 轻新粗野」）                 │
│  ├─ StorageAdapter 存储抽象                                       │
│  │    · 桌面（Tauri）：用户选定目录，真实 .md 文件                   │
│  │    · 移动（Tauri）：App 沙箱目录（iOS Documents）                 │
│  │    · Web（浏览器）：OPFS                                        │
│  ├─ 本地业务：文件树 / 编辑器 / 搜索 / 内链 / 回收站                 │
│  ├─ 同步引擎：manifest 拉取、diff、推送、冲突处理                    │
│  └─ AI Agent（前端运行）：                                          │
│       ├─ 工具循环（assistant-ui LocalRuntime）                      │
│       ├─ 14 个文件工具 → 直接操作本地 StorageAdapter                │
│       ├─ 消息封装：每次组装完整 messages + tools 数组                │
│       └─ LlmTransport 抽象：                                        │
│            RelayTransport（本期）→ POST {server}/api/ai/v1/...      │
│            DirectTransport（二期预留）→ 直连网关 + 下发 key          │
└──────────────────────────┬────────────────────────────────────────┘
                           │  HTTPS：同步 + 中继 + 认证
┌──────────────────────────▼────────────────────────────────────────┐
│  服务端（FastAPI，瘦身版）                                          │
│  ├─ /api/auth/*        username+password → token（含 sub）          │
│  ├─ /api/sync/*        同步：manifest / 文件推拉 / 乐观锁            │
│  ├─ /api/ai/v1/*       LLM 中继：校验 token → 注入 key → 转发网关     │
│  │                     流式透传；同时把对话归档到 data/sessions/      │
│  ├─ 鉴权中间件          require_user（现单用户，后期多用户切换点）     │
│  ├─ filesvc / sync     内部模块：维护服务端同步副本                   │
│  ├─ /health  + 可选静态托管 Web 版                                   │
│  └─ 存储：                                                           │
│       /notes  笔记本同步副本（挂载卷；后期按用户分命名空间）            │
│       /data   应用数据：sessions/ 归档（挂载卷）；后期 users/<sub>/ 沙盒 │
└─────────────────────────────────────────────────────────────────────┘
```

关键点：
- **客户端持有完整、可用的笔记本与完整可用的 Agent**——读写、搜索、AI 工具全部离线可完成，
  只有「LLM 回复」与「跨设备同步」需要网络；
- **服务端是三件事**：认证（含未来多用户）、同步（交换副本）、LLM 中继（持有 key）；
- **服务端不再有面向客户端编辑的文件 API**（`/api/files/*`、`/api/search`、`/api/chat` 删除），
  `filesvc` 作为内部模块保留，仅服务同步（与可选 MCP）。

---

## 3. 客户端设计

### 3.1 跨平台壳：Tauri 2

| 平面 | 壳 | 存储根 | 构建 |
|------|-----|--------|------|
| Windows / macOS / Linux | Tauri desktop（WebView2 / WKWebView / WebKitGTK） | 用户通过目录选择器选定的笔记目录 | `tauri build`（nsis / dmg / appimage+deb） |
| iOS / Android | Tauri mobile | App 沙箱，笔记放 Documents（iOS 可经「文件」App 访问） | Xcode / Android Studio；CI 需 macOS runner + 签名证书 |
| Web | 无壳，浏览器 | OPFS（Origin Private File System） | `vite build`，静态托管（可选） |

- 包体约 10MB 级；Rust 壳负责目录选择、文件系统、托盘、自动更新（`tauri-plugin-updater`）等原生能力；
- UI 代码零分叉：六个目标共用 `src/web`，仅存储适配器按平台注入。

### 3.2 存储抽象 StorageAdapter

```ts
interface StorageAdapter {
  readDir(path: string): Promise<Entry[]>;
  readFile(path: string): Promise<{ content: string; hash: string; mtime: number }>;
  writeFile(path: string, content: string, baseHash?: string): Promise<void>; // 乐观锁，冲突抛 ConflictError
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;   // 移入 .trash/（保留 v1 语义）
  stat(path: string): Promise<Entry | null>;
  watch?(cb: () => void): void;          // 可选：桌面端目录变更监听
}
```

三个实现：`TauriFsAdapter`（桌面/移动，`@tauri-apps/plugin-fs`）、`OpfsAdapter`（Web）。
**这是整个改造的地基**：v1 中 `api.ts` 的文件 API 调用全部改走本地适配器。

- 桌面端坚持「文件即真相」：笔记就是磁盘上的纯 Markdown，git / 同步盘 / 其他工具可直接消费；
- 移动端无任意文件系统访问，沙箱目录内仍是真实文件（仅被系统隔离）；
- 只管理 `.md`（沿用 v1）；`.trash/` 属于笔记本内容，随同步走；
- **加密留缝**：StorageAdapter 与同步引擎之间预留编解码插槽（§5.6），本期直通。

### 3.3 业务模块前移（相对 v1 的改动）

| 模块 | v1 | v2 |
|------|----|----|
| 文件树 / 新建 / 重命名 / 删除 | REST `/api/files/*` | 本地 StorageAdapter |
| 编辑保存 / 乐观锁 409 | 服务端 hash | 本地 hash（同机制） |
| 全文搜索 / 反链 | 服务端 `/api/search` | **本地索引**（内存遍历即可，目录规模小） |
| AI 会话恢复 UI | 未做 | **不做**（D6：会话不呈现客户端） |
| AI 悬浮窗 chat | 服务端 Agent SSE | **前端 Agent + LLM 中继**（§3.4） |
| 登录 | 单口令 | username + password（§6） |

### 3.4 AI Agent（客户端运行 + LLM 中继）

```
AI 悬浮窗（assistant-ui LocalRuntime）
     │  ① 消息封装：完整 messages + tools 数组（+ conversation_id）
     ▼
LlmTransport 抽象
     ├─ RelayTransport（本期）：POST {server}/api/ai/v1/chat/completions
     │      Bearer = 用户 token；服务端注入真实 LLM key 后转发网关，流式回传
     └─ DirectTransport（二期预留）：直连 LLM 网关（key 下发，见 §7）
     ▼
工具循环（前端 TS 实现，替代 v1 agent.py）
     ├─ 读工具：list_tree / read_file / search_files / list_backlinks / get_outline
     └─ 写工具：create_file / write_file / append_file / move_file / delete_file
            └── 全部直接执行于本地 StorageAdapter（不经过服务端）
```

- **工具语义、写授权（会话级确认弹窗）、`.trash/` 删除、免确认开关全部沿用 v1 设计**，仅执行位置改为本地；
- **消息封装**：客户端每次请求携带完整 messages 数组（服务端无状态），附 `conversation_id`
  仅供服务端归档分组；**客户端不请求、不展示任何会话记录**，刷新/重启 = 新对话；
- 中继为 **OpenAI 兼容透传**：客户端可用 OpenAI SDK，`baseURL = {server}/api/ai/v1`、
  `apiKey = 用户 token`，切换到 DirectTransport 只改这两个参数（二期的全部改动量）；
- 写类工具的会话级授权（write-gate）状态保存在**当前对话内存**中，不持久化、不跨对话。

### 3.5 UI 与响应式

- 设计 token 全部沿用（`--bg/--tx/--blue/--orange/--lime...`，见 `theme.css` 与 v1 PRODUCT.md §6.1），
  字体 fontsource 随包离线可用，六端视觉零成本一致；
- 布局两档：**桌面双栏**（现有形态）/ **移动单栏**——侧滑文件树抽屉、AI 面板全屏 sheet、触控目标 ≥44px；
- 快捷键平台归一（⌘/Ctrl），移动端提供等价手势/按钮；
- 需实测：CodeMirror 6 在 iOS WKWebView 的触控选区与软键盘顶起行为（M5 验证项）。

### 3.6 离线行为

- 读写、搜索、内链跳转、**AI 工具调用**完全离线可用（工具不依赖网络）；
- 仅两类操作需要网络：LLM 中继（无网时 chat 给出「离线」提示）与同步；
- 同步不可用时静默降级：状态栏显示「离线 / 待同步 N 项」，恢复网络后自动补齐；
- token 过期不影响本地编辑与 AI 工具，仅中继与同步需重新登录。

---

## 4. 服务端设计

### 4.1 职责边界

**保留 / 新增**
- 认证：username + password → token（含 `sub`），鉴权中间件统一收口（§6）；
- 同步：manifest + 文件推拉 + 乐观锁（新，§5）；
- **LLM 中继**：`/api/ai/v1/*` OpenAI 兼容透传（新，替代 v1 `/api/chat` Agent 运行时）；
- 会话归档：中继副产品，写 `data/sessions/`（§4.4），**不暴露任何读取 API**；
- `filesvc` / `sync`：内部模块，维护服务端同步副本；
- `/health`；可选静态托管 Web 版（建议保留，浏览器即开即用）。

**删除**
- `agent.py`（Agent 前移客户端）、`mcp_server.py`（可选 P2 观察项，见未决项）；
- `GET/PUT /api/files/*`、`POST /api/files`、`/api/search`、`/api/chat`、`GET /api/sessions`；
- 笔记本内 `.agents/` 目录（R1）。

### 4.2 API 清单（v2）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | `{username, password}` → `{token, expires_at}` |
| `POST` | `/api/auth/refresh` | 续期（token 内 `sub` 不变） |
| `GET` | `/api/sync/manifest` | `{rev, files:[{path, hash, mtime, size}]}` |
| `GET` | `/api/sync/file?path=` | `{content, hash, mtime}` |
| `PUT` | `/api/sync/file` | `{path, content, base_hash}`；hash 不符 → 409 |
| `POST` | `/api/ai/v1/chat/completions` | **LLM 中继**：OpenAI 兼容，Bearer 用户 token，服务端注入 LLM key 后透传（含流式）；同时归档对话 |
| `GET` | `/health` | 免鉴权 |

> 全部业务接口（除 `/health`）过鉴权中间件，中间件从 token 解出 `sub` 挂到请求上下文——
> 这是后期多用户模式的唯一切换点（§6）。
>
> 另预留（本期不实现）：`GET /api/ai/config` —— 二期 DirectTransport 时下发网关地址与密钥（§7）。

### 4.3 模块结构

```
src/api/app/
├── main.py        # FastAPI：路由注册 + 中间件 + 静态托管
├── config.py      # env：口令、TTL、LLM 网关、NOTES_ROOT、DATA_DIR
├── auth.py        # ★改：username+password 校验、token 签发/校验（含 sub）、鉴权中间件
├── sync.py        # ★新：manifest 生成（增量缓存）、文件推拉、rev 单调递增、按 sub 隔离命名空间
├── relay.py       # ★新：OpenAI 兼容透传（httpx 流式）、注入 LLM key、限速、对话归档
├── filesvc.py     # 沿用 v1（路径防护/CRUD/乐观锁/回收站），服务端同步副本操作
├── archive.py     # ★改：原 sessions.py —— 中继对话归档到 DATA_DIR/sessions/，无对外 API
└── models.py      # Pydantic
```

> v1 的 `agent.py`、`mcp_server.py`、`search.py` 随 Agent 前移删除（MCP 若保留才需要 search）。

### 4.4 会话归档（D6 落地）

- **位置**：`$NOTE_MD_DATA_DIR/sessions/`，笔记本目录不再出现 `.agents/`；
- **写入**：中继每次请求按 `conversation_id` 追加（时间戳、用户消息、AI 回复、工具调用摘要——
  工具执行在客户端，客户端可在消息封装时附带工具摘要，或仅归档 LLM 往返内容，开工时定）；
- **读取**：**无任何对外 API**；客户端无历史记录 UI，不落任何会话存储；
- 归档是中继的副产品，用于服务端排障与后期用户空间审计；`/data` 独立挂载卷，
  备份策略与 `/notes` 分开（`workflow/backup.sh` 相应加一条）；
- 二期随 §7 变化：中继切 DirectTransport 后，归档改为「客户端加密上传」或「仅客户端留存」。

### 4.5 部署（compose 形态）

```yaml
services:
  note-md:
    image: ghcr.io/zunley/note.md:latest
    ports: ["8080:8080"]
    volumes:
      - ./notes:/notes          # 笔记本同步副本
      - ./data:/data            # 应用数据（sessions/ 归档）★新
    environment:
      NOTE_MD_USERNAME: ${NOTE_MD_USERNAME}   # ★单口令 → 账号口令
      NOTE_MD_PASSWORD: ${NOTE_MD_PASSWORD}
      NOTE_MD_TOKEN_TTL: 72h
      NOTE_MD_DATA_DIR: /data   # ★新，默认 /data
      OPENAI_BASE_URL: ...
      OPENAI_API_KEY: ...       # 只进中继，不下发
      OPENAI_MODEL: ...
      TZ: Asia/Shanghai
    restart: unless-stopped
```

---

## 5. 同步协议（v1 实现）

### 5.1 模型

- 服务端对每次内容变更（客户端推送）递增全局 `rev`；
- 每文件一个内容 `hash`（sha256，沿用 v1 `compute_hash`）；
- 同步范围：笔记本内全部 `.md`（含 `.trash/`），目录结构由文件路径隐含；
- **命名空间从第一天按 token `sub` 隔离**（单用户时即 `<sub>/` 前缀）——
  多用户切换时协议与路径不变，只加用户表（§6）。

### 5.2 流程

```
拉：GET /api/sync/manifest
    → 与本地 manifest diff
    → 缺失/变化的文件逐个 GET /api/sync/file 下载
推：本地变更（base_hash = 本地该文件上次同步到的版本）
    → PUT /api/sync/file
    → 200 则更新本地 base_hash；409 进入冲突处理
```

### 5.3 冲突处理（单文件级）

1. PUT 返回 409（服务端副本已被其他设备改过）；
2. 客户端下载服务端版本作为该文件新基线；
3. 本地未推送内容**另存为冲突副本**：`笔记 (冲突 20251105-1530).md`（同目录），随后正常推送副本；
4. 用户手动合并——不做自动合并（单用户场景冲突低频，宁可笨而可见）；
5. 冲突副本就是普通笔记，同步、编辑、AI 全部照常工作。

### 5.4 触发时机

- 保存后防抖推送（~2s）；
- App 回前台 / 窗口聚焦 / Web visibilitychange → 拉取 + 推送；
- 手动「立即同步」按钮；状态栏常驻 待同步计数 / 同步中 / 离线指示；
- 服务端无主动 Agent 写入（Agent 在客户端），无反向通知需求；可选 SSE 推 `rev` 变更（P2）。

### 5.5 不做（本期）

- CRDT / OT 协同编辑（单用户无需求）；
- git-backed 同步（版本历史 + 天然冲突处理，列为 v3 候选，见 §11 决议 V9）；
- 增量二进制补丁（Markdown 文件小，整文件推拉足够）。

### 5.6 加密留缝（D8，本期不实现）

- 同步层把 `content` 视为**不透明字节**：加密 = 在客户端「StorageAdapter ↔ 传输」之间插一个
  `CipherAdapter`（读时解密、写时加密），manifest 与 API 协议零改动；
- `hash` 定义为「传输字节的哈希」——密文哈希天然满足一致性，无需服务端理解明文；
- **已知泄露面（二期处理）**：文件路径目前明文（目录结构可见）→ 二期可换为
  路径哈希/加密封套；manifest 的 mtime/size 属旁路信息，可做舍入/填充；
- 服务端沙盒内容「完全加密」（§6 远期）即复用此 CipherAdapter，服务端只存密文 blob。

---

## 6. 认证、多用户与沙盒演进（D7）

### 6.1 本期（单用户，多用户就绪）

- `POST /api/auth/login {username, password}` → token（HMAC-SHA256 自实现，沿用 v1 结构，
  payload 增加 `sub` = username；TTL 可配、refresh 滚动、登录限速沿用）；
- 凭证来自环境变量 `NOTE_MD_USERNAME` / `NOTE_MD_PASSWORD`（单账号）；
- **全部业务接口统一过鉴权中间件** `require_user`：验签 → 解 `sub` → 挂请求上下文；
  业务代码只依赖上下文中的用户身份，**不出现任何「单用户假设」的分支**；
- 同步命名空间、归档目录均按 `sub` 组织（§5.1、§4.4）。

### 6.2 远期（多用户 + 每用户加密沙盒）

| 步骤 | 内容 | 涉及面 |
|------|------|--------|
| ① 用户表 | 引入存储的凭证（哈希口令），替代 env 单账号 | 仅 `auth.py` |
| ② 数据隔离 | `/notes/<sub>/`、`/data/users/<sub>/` 分命名空间（协议不变） | `sync.py` 路径前缀 |
| ③ 加密沙盒 | 每用户空间内容**完全加密**（复用 §5.6 CipherAdapter），服务端只见密文 | 客户端编解码层 |
| ④ token 增强 | 短 TTL、设备绑定、吊销列表 | `auth.py` |

**原则**：多用户是服务端的渐进升级，客户端协议与 UI 不感知；本期代码的验收标准之一是
「切换到多用户时，客户端零改动」。

---

## 7. 第二阶段展望：端到端加密（D8，本期只留缝）

**目标**：服务端绝对无法获取客户端信息（chat 内容、笔记内容、会话记录）。

**现状与矛盾**：本期 LLM 走服务端中继——中继必须把明文转发给外部大模型，**服务端必然见到 chat 明文**。
因此真 E2E 的前提是中继退役：

1. **DirectTransport**：实现预留的 `GET /api/ai/config` → `{base_url, api_key, model}`，
   客户端直连网关；key 下发的代价是 key 出现在客户端（单用户自托管可接受；配合短 TTL、
   内存缓存不落盘缓解）——或未来使用客户端可控的 LLM 端点；
2. **同步加密**：插入 §5.6 的 CipherAdapter，服务端只存密文（含路径封套）；
3. **会话记录**：中继退役后归档来源改变——客户端加密后上传，或仅客户端留存；
4. 以上三项都**不改服务端协议形状**，只换客户端的 Transport/Cipher 实现——
   这正是 D8 所谓「留缝」的全部含义。

**本期写代码时的三条纪律**（不增加实现成本）：
- LLM 调用收敛为单一模块 `llmTransport.ts`（现为 Relay 实现）；
- 同步的 content 编解码走统一函数（现为直通）；
- 业务接口不读取服务端文件明文语义（hash 以传输字节为准）。

---

## 8. 技术选型汇总

| 层 | 选择 | 说明 |
|----|------|------|
| 跨平台壳 | **Tauri 2**（Rust） | 六端一套代码；桌面真实目录、移动沙箱 |
| 前端 | React 19 + Vite 6 + TS（沿用） | 现有代码 100% 复用 |
| 编辑器 | CodeMirror 6（沿用） | 内联渲染方案 A + 分栏 B 不变 |
| 聊天 UI | @assistant-ui/react（沿用） | LocalRuntime + 前端工具循环 |
| Agent 工具循环 | 前端 TS 实现（v1 `agent.py` 移植） | 工具打本地 StorageAdapter |
| LLM 接入 | 服务端中继（OpenAI 兼容透传，httpx 流式） | key 只存服务端 |
| 后端 | Python 3.12 + FastAPI（沿用） | 新增 sync.py / relay.py，删除 agent/mcp/search |
| 本地存储 | Tauri fs / OPFS（StorageAdapter） | 不引入数据库 |
| 样式 | 方案四 design tokens + fontsource | 资产原样迁移 |
| 打包 | Docker（服务端）+ Tauri bundler（五端）+ vite（Web） | CI 分三条流水线 |

---

## 9. 新仓库目录结构建议

```
note.md/
├── src/
│   ├── api/          # Python 后端（auth + sync + relay + archive）
│   ├── web/          # React 前端（六端 UI + StorageAdapter + 同步引擎 + Agent）
│   └── tauri/        # Rust 壳（Tauri 2；目录名以 tauri init 结果为准，见未决项）
├── docs/             # PRODUCT / DESIGN / style / DEV
├── Dockerfile
├── compose.yaml
└── Makefile
```

**从原仓库带走的资产**：`docs/style/`（样式定稿）、`src/web/src/theme.css`（572 行 tokens+样式）、
字体依赖（package.json fontsource 三项）、v1 全部代码作参考实现
（尤其 `filesvc.py`、`Chat.tsx` 的工具卡片/write-gate、`agent.py` 的工具定义与循环语义）。

---

## 10. 里程碑

| # | 名称 | 内容 | 出口标准 |
|---|------|------|----------|
| M1 | 本地优先 | StorageAdapter（OPFS 先行）；树/编辑/搜索/内链/回收站切本地；auth 改 username+password + 中间件收口 | 断网下全部本地功能可用 |
| M2 | Agent 前移 + 中继 | 前端工具循环（工具打本地）；`/api/ai/v1` 中继；对话归档到 data 目录且无对外 API；删服务端 agent/chat/sessions API | AI 全功能在客户端工作，key 不出服务端 |
| M3 | 同步 + 服务端瘦身 | sync.py + 同步引擎（按 sub 命名空间）；删 files/search API；compose 加 `/data` 卷；加密缝自检（§7 三条纪律） | 两客户端经服务端双向同步，冲突产副本 |
| M4 | Tauri 桌面 | Rust 壳 + 目录选择器 + 桌面 fs 适配器；Win/macOS/Linux 打包 | 三桌面平台安装包可编辑本地目录并同步 |
| M5 | 响应式 + 移动端 | 移动布局（抽屉/sheet）；iOS/Android 打包（需签名） | 真机可用：编辑、同步、chat |
| M6 | 打磨 | ⌘K 搜索面板、内链补全、自动更新、状态栏同步指示 | 对齐 v1 遗留 P1 清单（会话恢复 UI 已按 D6 取消） |

> 每个里程碑结束均为可发布状态，不打断现有 v1 Docker Web 版。

---

## 11. 决议记录

| # | 问题 | 决议 |
|---|------|------|
| V1 | 跨平台方案 | Tauri 2 + 现有 React UI，六端一套代码 |
| V2 | 功能归属 | 业务全在客户端，本地优先，离线可用 |
| V3 | Agent 位置 | **客户端**：工具循环与文件工具全部打本地 |
| V4 | LLM 接入 | **服务端中继**（OpenAI 兼容透传）：key 永不下发；客户端经 LlmTransport 抽象切换直连（二期） |
| V5 | 会话记录 | 仅服务端归档（data 目录），无对外 API；客户端只封装消息、无历史 UI、不落存储 |
| V6 | 服务端职责 | 认证 + 同步 + LLM 中继（+ 归档）；删 files/search/chat/sessions API 与 agent 运行时 |
| V7 | 认证与多用户 | username+password → token（含 sub）+ 统一鉴权中间件；远期多用户、per-user 加密沙盒（§6），客户端协议不感知 |
| V8 | E2E 加密 | 同步与消息加密**一期不做**，留缝：llmTransport / CipherAdapter / 传输字节哈希（§5.6、§7） |
| V9 | 同步策略 | manifest + hash + 乐观锁 + 冲突副本；git-backed 列为 v3 候选 |
| V10 | Web 版 | 保留（第六目标），OPFS 适配器 |

**未决项**（开工时定，不阻塞）：
1. Rust 壳目录命名：Tauri 默认根目录 `src-tauri/` vs 归入 `src/tauri`（需验证 CLI 支持）；
2. MCP 端点去留（Agent 已在客户端，服务端 MCP 只服务外部客户端如 Cursor；建议 v3 再议）；
3. 会话归档粒度：仅 LLM 往返内容，还是含客户端工具摘要（§4.4）；
4. iOS 分发方式：TestFlight / 自签 / 仅侧载；
5. `.trash/` 与冲突副本的清理策略（沿用 v1「暂无 UI，手动清理」）。
