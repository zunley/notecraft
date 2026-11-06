# notecraft 设计文档

> **notecraft** 是一款跑在 Windows / Linux / macOS / iOS / Android / Web 六端的本地优先 Markdown 笔记本：
> 笔记就是磁盘上的纯 `.md` 文件，离线可用，内置 AI 助手帮你查找与整理，跨设备经服务端同步——
> 而**服务端从头到尾看不到任何笔记内容**。
>
> 状态：**定稿**。本文回答「做什么、为什么」；仓库如何落地见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 1. 产品定位与设计原则

四条原则贯穿全部设计，后面每一节都是它们的具体化：

1. **本地优先**——文件树、编辑、搜索、内链、回收站、AI 工具全部在本地完成，断网可用；
   只有「LLM 回复」与「跨设备同步」需要网络。
2. **客户端是功能主体**——AI Agent（工具循环、文件工具、写授权确认）完整运行在客户端；
   服务端不执行任何笔记逻辑。
3. **服务端极简**——只做三件事：认证、同步、LLM 中继。
4. **零知识**——服务端存储的笔记数据全部是密文，连文件路径都不可读；
   LLM 对话经服务端中继转发但**零留存**；会话历史只存在于用户自己的设备上。

---

## 2. 总体架构

> 本图回答「为什么这样分」；仓库实际目录、分层与依赖铁律以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准。

```
┌──────────────────────── 客户端（功能主体）────────────────────────┐
│ React UI（六端通用，样式：方案四 · 轻新粗野）                       │
│ ├─ StorageAdapter 存储抽象（本地永远是明文 .md）                    │
│ │    · 桌面/移动（Tauri）：用户目录 / App 沙箱                       │
│ │    · Web（浏览器）：OPFS                                          │
│ ├─ 本地业务：文件树 / 编辑器 / 搜索 / 内链 / 回收站                 │
│ ├─ crypto/：口令派生与解锁（keystore）+ 内容/路径加解密（envelope） │
│ ├─ 同步引擎：manifest 拉取、diff、推送、冲突副本                     │
│ │    （进出服务端的每一份数据都经过 codec 加密）                     │
│ ├─ AI Agent（前端运行）：                                          │
│ │    ├─ 工具循环（assistant-ui LocalRuntime）                       │
│ │    ├─ 文件工具 → 直接操作本地 StorageAdapter（离线可用）           │
│ │    └─ LlmTransport：Relay（当前）/ Direct（演进预留）             │
│ └─ sessionStore：会话历史仅存本机（IndexedDB）                      │
└──────────────────────────┬────────────────────────────────────────┘
                           │ HTTPS：认证 + 同步 + LLM 中继
┌──────────────────────────▼────────────────────────────────────────┐
│ 服务端（FastAPI，瘦身版，分层 + 端口-适配器）                       │
│ ├─ /api/auth/*      注册 / 登录 / 续期 / 换口令 / 注销（零知识）    │
│ ├─ /api/sync/*      manifest / 文件推拉 / 乐观锁（按 uid 隔离）      │
│ ├─ /api/ai/v1/*     LLM 中继：校验 token → 注入 key → 流式透传      │
│ │                   ★ 零留存：不归档、不记录请求体、无会话 API      │
│ ├─ /health（纯 API——静态由 Web 独立镜像承载）                      │
│ └─ 存储：/notes 各用户密文仓库（卷）；/data 用户表（卷）           │
└─────────────────────────────────────────────────────────────────────┘
```

三条铁律：

1. **本地优先**——读写、搜索、内链、AI 工具全部离线可完成；只有「LLM 回复」与「跨设备同步」需要网络。
2. **口令与加密密钥永不进入服务端**——登录时客户端只发送本地派生的登录凭证，
   服务端仅存其哈希；笔记的加密密钥服务端拿不到、也打不开。
3. **服务端零留存**——中继不归档对话、不记录请求体；同步只存密文；
   除用户记录与打不开的密钥封装外，服务端不保存任何用户数据。

**Agent 位置**：AI Agent 从项目第一天起就完整运行在客户端——工具循环、文件工具、
prompt 组装、写授权（write-gate）、对话上下文管理全在前端；服务端 `/api/ai/v1/*`
自始至终只是透明转发（注入 key + 流式透传），不组装 prompt、不执行工具、不持会话状态。

---

## 3. 客户端设计

### 3.1 跨平台壳：Tauri 2

| 平面 | 壳 | 存储根 |
|------|-----|--------|
| Windows / macOS / Linux | Tauri desktop（WebView2 / WKWebView / WebKitGTK） | 用户通过目录选择器选定的笔记目录 |
| iOS / Android | Tauri mobile | App 沙箱，笔记放 Documents（iOS 可经「文件」App 访问） |
| Web | 无壳，浏览器 | OPFS（Origin Private File System） |

- 一套代码打包六端，UI 零分叉：仅存储适配器按平台注入；
- 桌面端坚持「文件即真相」：笔记就是磁盘上的纯 Markdown，git / 同步盘 / 其他工具可直接消费；
- 只管理 `.md`；`.trash/` 属于笔记本内容，随同步走。

### 3.2 存储抽象 StorageAdapter

```ts
interface StorageAdapter {
  readDir(path: string): Promise<Entry[]>;
  readFile(path: string): Promise<{ content: string; hash: string; mtime: number }>;
  writeFile(path: string, content: string, baseHash?: string): Promise<void>; // 乐观锁，冲突抛 ConflictError
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;   // 移入 .trash/（回收站属笔记本内容、随同步走）
  stat(path: string): Promise<Entry | null>;
  watch?(cb: () => void): void;          // 可选：桌面端目录变更监听
}
```

- 两个实现：`TauriFsAdapter`（桌面/移动）、`OpfsAdapter`（Web）；
- **本地永远是明文**——这是「文件即真相」承诺的一部分，加密只发生在数据离开设备的边界上（见 §6.4）；
- 业务模块只依赖此接口，平台差异由实现类消化。

### 3.3 本地业务模块

| 模块 | 实现方式 |
|------|----------|
| 文件树 / 新建 / 重命名 / 删除 | 本地 StorageAdapter |
| 编辑保存 / 乐观锁冲突 | 本地 hash 比对（同同步机制），冲突抛 `ConflictError` |
| 全文搜索 / 反链 | `lib/search.ts` 单一实现（内存遍历即可，目录规模小），⌘K 与 AI 工具 `search_files` 共用——服务端没有搜索 API |

### 3.4 AI 助手（客户端 Agent + LLM 中继）

```
AI 悬浮窗（assistant-ui LocalRuntime）
     │  ① 消息封装：完整 messages + tools 数组（+ conversation_id）
     ▼
LlmTransport 抽象（ai/llmTransport.ts，单一模块）
     ├─ RelayTransport（当前）：POST {server}/api/ai/v1/chat/completions
     │      Bearer = 用户 token；服务端注入真实 LLM key 后转发网关，流式回传
     └─ DirectTransport（演进预留）：直连网关，见 §6.7
     ▼
工具循环（前端 TS 实现）
     ├─ 读工具：list_tree / read_file / search_files（复用 lib/search）/ list_backlinks / get_outline
     └─ 写工具：create_file / write_file / append_file / move_file / delete_file
            └── 全部直接执行于本地 StorageAdapter（不经过服务端，离线可用）
```

- **工具语义**：写工具的会话级授权（write-gate 确认弹窗）、`.trash/` 删除、免确认开关；
- **消息封装**：客户端每次请求携带完整 messages 数组（服务端无状态）；
- **会话只存本机**：对话历史写入 IndexedDB（`ai/sessionStore.ts`），刷新/重启可恢复上次对话；
  服务端不保存、不提供、也无从获取任何会话记录；
- 中继为 **OpenAI 兼容透传**：客户端可用 OpenAI SDK，`baseURL = {server}/api/ai/v1`、
  `apiKey = 用户 token`，切换到直连只改这两个参数；
- write-gate 状态保存在当前对话内存中，不持久化、不跨对话。

### 3.5 UI 与响应式

- 设计 token 全部沿用（`--bg/--tx/--blue/--orange/--lime...`，见 `theme.css` 与 `docs/style/`），
  字体 fontsource 随包离线可用，六端视觉零成本一致；
- 布局两档：**桌面双栏** / **移动单栏**——侧滑文件树抽屉、AI 面板全屏 sheet、触控目标 ≥44px；
- 快捷键平台归一（⌘/Ctrl），移动端提供等价手势/按钮；
- 需实测：CodeMirror 6 在 iOS WKWebView 的触控选区与软键盘顶起行为（里程碑 M5 验证项）。

### 3.6 离线行为

- 读写、搜索、内链跳转、**AI 工具调用**完全离线可用；
- 仅两类操作需要网络：LLM 中继（无网时 chat 给出「离线」提示）与同步；
- 同步不可用时静默降级：状态栏显示「离线 / 待同步 N 项」，恢复网络后自动补齐；
- token 过期不影响本地编辑与 AI 工具，仅中继与同步需重新登录。

### 3.7 代码组织与扩展点

前端只做**形状级扩展点**（接口、注册表、统一函数），不引入框架级抽象：

```
src/client/web/src/
├── main.tsx / App.tsx / theme.css
├── lib/          # config（配置单点）、api（auth/key/sync + HTTP→领域错误唯一翻译点）、
│                   errors（领域错误单源）、search（搜索唯一实现）、markdown
├── state/        # zustand slices：auth / sync / notes（轻量，三个切片而已）
├── storage/      # StorageAdapter（TauriFs / OPFS）——本地明文真相
├── crypto/       # keystore：口令派生、解锁、密钥常驻内存（唯一持密，驱动 envelope）
│                 # envelope：无状态 AES-GCM 内容/路径加解密（密钥入参出）
├── sync/         # 同步引擎 + codec（编解码唯一出口，委托 crypto/envelope）
├── ai/           # agent、tools（注册表）、llmTransport、sessionStore（IndexedDB 会话）
└── features/     # FileTree / Editor / Chat / Login / StatusBar——按 feature 自包含
```

**六个扩展点**（将来换实现只动这六处，调用方零改动）：

| 扩展点 | 位置 | 将来换实现的场景 |
|--------|------|------------------|
| Keystore | `crypto/keystore.ts` | 设备密钥、平台生物识别免口令、per-note 密钥 |
| 编解码 | `sync/codec.ts` → `crypto/envelope.ts` | 算法升级、路径封套格式演进——协议零改动 |
| SessionStore | `ai/sessionStore.ts` | 会话导出、跨端漫游（若将来要做） |
| LlmTransport | `ai/llmTransport.ts` | 直连网关（见 §6.7） |
| StorageAdapter | `storage/` | 新平台适配器 |
| 工具注册表 | `ai/tools.ts`（`ToolSpec[]`） | 新增 AI 工具 = 加一项声明 |

**状态管理**：zustand 三个 slice（auth / sync / notes）——StatusBar 订阅 sync、
Login 订阅 auth，此外不学任何概念。同步基线由 `sync/engine` 自持，slice 只存投影。

**依赖铁律**：features → state/storage 接口/lib；state 不 import features；tools 只依赖
StorageAdapter + lib/search；平台 API（`@tauri-apps/*`）只出现在 storage 与壳层——
建议用 lint 在 CI 强制（详见 [ARCHITECTURE.md](ARCHITECTURE.md) §3）。

**明确不做**：路由框架（单页无路由需求）、DI 容器、事件总线、Redux、service worker。

---

## 4. 服务端设计

### 4.1 职责边界

**保留**——只有四组接口：

- 认证：**开放注册**（策略可配 open/invite/closed）、登录、续期、换口令、注销；
- 同步：manifest + 文件推拉 + 乐观锁（密文形态）；
- LLM 中继：OpenAI 兼容透传，**零留存**；
- `/health`。

**明确不做**——以下能力一律不提供：

- 面向客户端的文件编辑 API、搜索 API、聊天 API、会话查询 API；
- 任何 Agent 逻辑（工具循环、prompt 组装、写授权）；
- 任何对话归档、请求体日志、用户行为审计。

### 4.2 API 清单

**接口的唯一权威规格是 [API.md](API.md)**（请求/响应形状、错误码、限流与配额）——
此处只列分组概览：

| 分组 | 端点 | 要点 |
|------|------|------|
| 账户 | `GET /api/auth/policy`、`POST register/login/refresh/key`、`DELETE /api/auth/account` | 任何人可注册；`password` 字段 = 客户端派生的登录凭证 L（§6.3）；注销即时失效全部 token |
| 同步 | `GET /api/sync/manifest`、`GET/PUT/DELETE /api/sync/file` | 服务端只见密文；`rev` 为**每用户专属**计数器；乐观锁 409 |
| 中继 | `POST /api/ai/v1/chat/completions` | OpenAI 兼容透传，零留存，每用户日配额 |
| 健康 | `GET /health` | 免鉴权 |

- 路径中的 `/v1` 是 OpenAI 兼容约定，与本项目版本无关；
- 除 `/health`、`policy`、`register`、`login` 外全部过 `require_user` 鉴权
  （验签 → 解 `sub` → 挂上下文）——**多租户的唯一切换点**。

### 4.3 部署

- **服务端**：Docker 容器（**纯 API**——完全分容器，静态由独立 Web 镜像承载），两个卷：
  - `/notes`——各用户密文仓库（`<uid>/` 分目录），**全部是密文**；
  - `/data`——用户表（登录凭证哈希 + protected_key）。
    **这一卷必须备份**：丢失意味着无人能登录、无人能解锁笔记（兜底靠用户手里的恢复密钥文件，见 §6.2）；
- **桌面**：`tauri build` → nsis / dmg / appimage+deb；
- **移动**：Xcode / Android Studio，CI 需 macOS runner 与签名证书；
- **Web**：`vite build` 静态资源，独立镜像 `ghcr.io/zunley/notecraft` 托管（完全分容器，见 ARCHITECTURE §7）。

---

## 5. 同步协议

### 5.1 模型

- 服务端对每个用户的推送递增其**专属 `rev`**（不跨用户，互不干扰也不泄露活动）；
- 每文件一个内容 `hash`（sha256，**传输字节**的哈希——加密后即密文哈希，见 §6.4）；
- 同步范围：笔记本内全部 `.md`（含 `.trash/`），目录结构由文件路径隐含；
- 命名空间按 token `sub`（= 注册时生成的**不可变 uid**）隔离——
  天然多租户：加用户 = 加一个 `<uid>/` 目录，协议与客户端零改动（详见 [API.md](API.md) §8）。

### 5.2 流程

```
拉：GET /api/sync/manifest
    → 本地解密路径 → 与本地 manifest diff
    → 缺失/变化的文件逐个 GET /api/sync/file → 解密 → 写入本地
推：本地变更（base_hash = 本地该文件上次同步到的版本）
    → 加密后 PUT /api/sync/file
    → 200 则更新本地 base_hash；409 进入冲突处理
```

### 5.3 冲突处理（单文件级）

1. PUT 返回 409（服务端副本已被其他设备改过）；
2. 客户端下载服务端版本作为该文件新基线；
3. 本地未推送内容**另存为冲突副本**：`笔记 (冲突 20251105-1530).md`（同目录），随后正常推送副本；
4. 用户手动合并——不做自动合并（同账号多设备的冲突低频，宁可笨而可见）；
5. 冲突副本就是普通笔记，同步、编辑、AI 全部照常工作。

### 5.4 触发时机

- 保存后防抖推送（~2s）；
- App 回前台 / 窗口聚焦 / Web visibilitychange → 拉取 + 推送；
- 手动「立即同步」按钮；状态栏常驻 待同步计数 / 同步中 / 离线指示；
- 服务端无主动写入（Agent 在客户端），无反向通知需求；可选 SSE 推 `rev` 变更（后续候选）。

### 5.5 明确不做

- CRDT / OT 协同编辑（每账号独立命名空间，无协同需求）；
- git-backed 同步（版本历史 + 天然冲突处理，列为后续候选）；
- 增量二进制补丁（Markdown 文件小，整文件推拉足够）。

---

## 6. 安全：零知识与端到端加密

### 6.1 保护边界

| 服务端可见（可接受） | 服务端不可见（必须） |
|---|---|
| 用户名、登录时间、token | **笔记正文**（AES-GCM 密文） |
| 密文 blob、密文哈希、`rev` | **文件路径与目录结构**（路径密文） |
| 密文大小（已填充对齐）、更新频率 | 口令、KEK、MK（全部只在客户端） |
| `protected_key`——一个打不开的信封 | 会话历史（仅客户端 IndexedDB） |
| LLM 对话明文（中继期间流过，**零留存**） | 恢复密钥文件 REK（仅用户持有） |

一条诚实的例外：**当你让 AI 读取某篇笔记时**，被读取的内容会作为对话上下文随消息
经中继发给 LLM——服务端在此期间可见，但不落任何存储（§6.5）。不使用 AI 时，
笔记内容默认不出客户端。

### 6.2 密钥体系

```
口令（用户唯一记忆的秘密）
  │ Argon2id（salt 由用户名确定性派生；参数客户端固定，六端一致）
  ▼
 root
  ├─ HKDF(root, info="login") → L    登录凭证：发给服务端，服务端只存 hash(L)
  └─ HKDF(root, info="enc")   → KEK  密钥加密密钥：只在客户端
                                │ 用 KEK 解开服务端返回的信封
                                ▼
                    MK（随机 256bit 主密钥，仅存内存，不落盘）
                    ├─ 内容密钥 → 笔记密文（AES-256-GCM）
                    ├─ 路径密钥 → 路径密文
                    └─ （预留）设备密钥 / 分享密钥

服务端保存：protected_key = AES-GCM(KEK, MK)   ← 打不开的信封，只负责存与还
用户保存：  REK 恢复密钥文件（也 wrap 了一份 MK）→ 忘记口令时的逃生舱
```

设计要点：

- **单口令**：用户只记一个口令，它同时派生登录凭证与加密密钥——登录即解锁，加密对用户无感（§6.3）；
- **MK 随机生成**而非口令直接派生：数据安全上限不被口令强度绑架，且换口令只需重新封装信封，
  **笔记一个字节都不用重加密**；
- **Argon2id 挡离线爆破**：服务端即使拖库，拿到的只是 `hash(L)` 与打不开的 `protected_key`，
  破解需对每个口令候选完整跑一遍 Argon2id；
- **REK 恢复密钥文件**：注册时导出一次，离线保存；忘记口令时用它解开 MK 重设口令。
  零知识的固有代价是「服务端帮不了你」，REK 就是给这个代价留的出口。

### 6.3 登录即解锁（用户视角只有一个输入框）

```
用户输入用户名 + 口令（唯一一次输入）
        │
        ▼ 以下全部在客户端本地完成
 root = Argon2id(口令, salt)
   ├─ L   = HKDF(root, "login") ──► POST /api/auth/login {username, password: L}
   └─ KEK = HKDF(root, "enc")                          │
                                                        ▼
                              服务端：校验 hash(L) → 签发 token
                                        + 返回 protected_key
                                                        │
        MK = AES-GCM 解开(protected_key, KEK) ◄─────────┘
        ▼
   MK 常驻内存 → 同步自动解锁 → 一切照常
```

- **注册**：新用户在登录页点「创建账号」→ 本地生成 MK →
  `POST /api/auth/register {username, password: L, protected_key}` → 直接拿到 token（注册即登录）；
  注册策略（open/invite/closed）由服务端配置，见 [API.md](API.md) §3；
- **多设备**：另一台设备输入同一口令 → 派生出同一 KEK → 登录拿回信封 → 解锁。零额外步骤；
- **换口令**：客户端重新派生 → 用新 KEK 重新封装 MK → `PUT /api/auth/key` 更新。
  笔记密文不动（MK 没变）；
- **token 刷新不打扰**：续期不需要口令；只有登录失效时才需重新输入（顺带重新解锁）；
- 服务端从头到尾没见过口令、KEK、MK——即使服务端完全被攻破，攻击者也读不到笔记。

### 6.4 笔记加密（数据离开设备的边界）

- **信封格式**：`NC1 | nonce(12B) | 密文 | GCM tag(16B)`，外层 base64 后作为字符串进 JSON
  （`NC1` 为版本前缀，便于将来平滑迁移算法）；
- **内容**：每次写入独立随机 nonce，AES-256-GCM 加密；
- **路径**：manifest 的 `path` 与 `PUT/GET` 的路径参数同样是密文——服务端连目录结构都看不到，
  按原样存取即可；
- **hash = sha256(传输字节)**：即密文哈希。乐观锁 `base_hash` 比对、`rev` 递增全部照旧，
  **服务端不需要理解任何明文语义，协议零改动**；
- **旁路信息掩蔽**：`size` 按 4KiB 块向上取整（掩盖真实长度）；`mtime` 真实值写进密文，
  manifest 只暴露按天舍入的粗粒度值；
- **本地永远明文**：加密只发生在「同步编解码」这一个边界上，磁盘上的 `.md` 保持可读——
  文件即真相、离线可用、其他工具可消费，三者都不受影响。

### 6.5 AI 对话的边界

当前 LLM 走服务端中继——中继必须把消息明文转发给外部大模型，**服务端在转发瞬间可见对话内容**。
对此的约束是：

- **零留存**：不归档、不写请求体日志、无会话 API、不持会话状态——转发完即消失；
- 会话历史只在客户端 `sessionStore`（IndexedDB），服务端无从获取；
- 要让对话对服务端也彻底不可见，前提是中继退役、客户端直连网关（§6.7）——
  即便如此，模型提供方仍会看到对话，这是使用 LLM 的固有边界。

### 6.6 已知泄露面（坦白列出）

- **流量分析**：密文大小（已按 4KiB 对齐）与更新频率仍暴露「什么时候改了多少东西」——
  自托管/小规模服务场景下接受这一泄露面，不追求流量分析防护；
- **路径等值**：路径采用确定性加密（同一路径恒为同一密文，服务端据此定位文件），
  因此「哪些文件被反复改名/移动」的等值关系可见，内容不可见；
- **登录元数据**：登录时间、IP 等常规服务端日志（不含请求体）。

### 6.7 演进方向

| 方向 | 内容 | 触发条件 |
|------|------|----------|
| 直连网关 | 实现 `GET /api/ai/config` 下发网关与 key，`LlmTransport` 切 Direct——对话对服务端也不可见 | 中继零留存仍不满足需求时 |
| 持久化用户表 | 文件版用户表（`/data/users/<uid>.json`）换 SQLite/Postgres，只动 `UserStore` 实现 | 用户数接近 ~10³ 或需事务/并发写 |
| 中继配额持久化 | `RelayQuota` 内存计数换持久化实现（重启不清零） | 需要精确计费/审计时 |
| 设备密钥 / 生物识别 | MK 用平台密钥库（Keychain / Keystore）封装，免口令解锁 | 体验优化，keystore 换实现即可 |
| 笔记分享 / 协作 | per-note 密钥 + 公钥封装 | 真实分享需求出现 |

---

## 7. 技术选型

| 层 | 选择 | 说明 |
|----|------|------|
| 跨平台壳 | Tauri 2（Rust） | 六端一套代码，不重写 UI |
| 前端 | React 19 + Vite 6 + TS | 现有 UI 100% 复用 |
| 编辑器 | CodeMirror 6 | 内联渲染 + 分栏预览 |
| 聊天 UI | @assistant-ui/react | LocalRuntime + 前端工具循环 |
| 状态管理 | zustand（三个 slice） | 轻量，不引 Redux |
| 加密 | WebCrypto AES-256-GCM + Argon2id（WASM） | 六端原生/随包可用，无自研密码学 |
| 会话存储 | IndexedDB | 仅客户端 |
| 本地存储 | Tauri fs / OPFS | 不引入数据库 |
| LLM 接入 | 当前服务端中继；演进直连 | 收敛在 `llmTransport.ts` 单模块 |
| 后端 | Python 3.12 + FastAPI | 瘦身版：认证 + 同步 + 中继 |
| 样式 | 方案四 design tokens + fontsource | 资产见 `docs/style/` |
| 打包 | Docker（服务端）+ Tauri bundler（五端）+ vite（Web） | CI 三条流水线 |

---

## 8. 里程碑

| # | 名称 | 出口标准 |
|---|------|----------|
| M1 | 本地优先 + 解锁 | 断网下全部本地功能可用；注册/登录即解锁（keystore + envelope） |
| M2 | AI 助手 + 中继 | AI 全功能在客户端工作，key 不出服务端；中继零留存，会话仅存本机 |
| M3 | 同步 + 零知识 | 两客户端经服务端双向同步，冲突产副本；**打开服务器卷看不到任何明文**（含路径） |
| M4 | Tauri 桌面 | 三桌面平台安装包，可编辑本地目录并同步 |
| M5 | 响应式 + 移动端 | 真机可用：编辑、同步、chat |
| M6 | 打磨 | ⌘K 搜索面板、内链补全、自动更新、状态栏同步指示 |

> 每个里程碑结束均为可发布状态。
