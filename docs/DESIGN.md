# notecraft 设计文档

> **notecraft** 是一款跑在 Windows / Linux / macOS / iOS / Android / Web 六端的本地优先 Markdown 笔记本：
> 笔记就是磁盘上的纯 `.md` 文件，离线可用，内置 AI 助手，跨设备同步——
> 而**服务端从头到尾看不到任何笔记内容**。
>
> 状态：**定稿**。本文只回答「做什么、为什么」；怎么落地见 [ARCHITECTURE.md](ARCHITECTURE.md)，
> 接口规格的唯一权威是 [API.md](API.md)。

---

## 1. 产品定位与设计原则

1. **本地优先**——文件树、编辑、搜索、内链、回收站、AI 工具全部在本地完成，断网可用；
   只有「LLM 回复」与「跨设备同步」需要网络。
2. **客户端是功能主体**——AI Agent（工具循环、文件工具、写授权确认）完整运行在客户端；
   服务端不执行任何笔记逻辑。
3. **服务端极简**——只做三件事：认证、同步、LLM 中继。
4. **零知识**——服务端存储的笔记数据全部是密文，连文件路径都不可读；
   LLM 对话经服务端中继转发但**零留存**；会话历史只存在于用户自己的设备上。

**Agent 位置**：AI Agent 从第一天起就完整运行在客户端——工具循环、文件工具、prompt 组装、
写授权（write-gate）、对话上下文管理全在前端；服务端 `/api/ai/v1/*` 自始至终只是透明转发
（注入 key + 流式透传），不存在「服务端 Agent 阶段」。

## 2. 总体架构

分层与依赖铁律以 [ARCHITECTURE.md](ARCHITECTURE.md) §1 为准，本文不复写图。三条铁律：

1. **本地优先**——读写、搜索、内链、AI 工具全部离线可完成。
2. **口令与加密密钥永不进入服务端**——登录凭证在客户端派生，服务端只存其哈希；
   笔记密钥（MK）只存在于客户端内存，服务端持有的 `protected_key` 是一个打不开的信封。
3. **服务端零留存**——中继不归档对话、不记录请求体；同步只存密文；
   除用户记录与打不开的密钥封装外不保存任何用户数据。

## 3. 客户端设计

### 3.1 跨平台壳：Tauri 2

| 平面 | 壳 | 存储根 |
|------|-----|--------|
| Windows / macOS / Linux | Tauri desktop | 用户选定的笔记目录 |
| iOS / Android | Tauri mobile | App 沙箱 Documents |
| Web | 无壳，浏览器 | OPFS（Origin Private File System） |

- 一套代码打包六端，UI 零分叉：仅存储适配器按平台注入；
- 桌面端「文件即真相」：笔记就是磁盘上的纯 Markdown；只管理 `.md`；`.trash/` 随同步走。

### 3.2 存储抽象 StorageAdapter

```ts
interface StorageAdapter {
  readDir(path: string): Promise<Entry[]>;
  readFile(path: string): Promise<{ content: string; hash: string; mtime: number }>;
  writeFile(path: string, content: string, baseHash?: string): Promise<void>; // 冲突抛 ConflictError
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;   // 移入 .trash/
  stat(path: string): Promise<Entry | null>;
  watch?(cb: () => void): void;
}
```

- 三个实现：`TauriFsAdapter`（桌面/移动）、`OpfsAdapter`（Web）；
- **本地永远是明文**——加密只发生在数据离开设备的边界上（§6.4）；业务模块只依赖此接口。

### 3.3 本地业务模块

| 模块 | 实现方式 |
|------|----------|
| 文件树 / 新建 / 重命名 / 删除 | 本地 StorageAdapter |
| 编辑保存 / 乐观锁冲突 | 本地 hash 比对，冲突抛 `ConflictError` |
| 全文搜索 / 反链 | `lib/search.ts` 单一实现（内存遍历），⌘K 与 AI 工具 `search_files` 共用——服务端没有搜索 API |

### 3.4 AI 助手（客户端 Agent + LLM 中继）

```
AI 面板（前端工具循环）
  → LlmTransport 抽象（ai/llmTransport.ts）
      ├─ RelayTransport（当前）：POST {server}/api/ai/v1/chat/completions，Bearer = 用户 token
      └─ DirectTransport（演进预留，§6.7）
  → 工具循环（前端执行）
      ├─ 读：list_tree / read_file / search_files / list_backlinks / get_outline
      └─ 写：create_file / write_file / append_file / move_file / delete_file
            └── 全部直接执行于本地 StorageAdapter（离线可用），写工具过 write-gate
```

- 每次请求携带完整 messages + tools（服务端无状态）；会话历史只存本机 IndexedDB；
- 中继为 OpenAI 兼容透传；write-gate 状态只在当前对话内存中，不持久化。

### 3.5 UI 与响应式

- 设计 token 见 `docs/style/`（方案四 · 轻新粗野）；字体 fontsource 随包离线可用；
- 布局两档：**桌面双栏** / **移动单栏**（侧滑抽屉、AI 全屏 sheet、触控 ≥44px）；
- 快捷键平台归一（⌘/Ctrl）；需实测：CodeMirror 6 在 iOS WKWebView 的触控选区与软键盘（M5 验证项）。

### 3.6 离线行为

- 读写、搜索、内链、**AI 工具调用**完全离线可用；仅 LLM 回复与同步需要网络；
- 同步不可用时静默降级（状态栏显示「离线 / 待同步 N 项」），恢复网络自动补齐；
- token 过期不影响本地编辑与 AI 工具，仅中继与同步需重新登录。

### 3.7 代码组织与扩展点

```
src/client/web/src/
├── lib/      # config（配置单点）、api（auth/key/sync + HTTP→领域错误唯一翻译点）、
│               errors（领域错误单源）、search（搜索唯一实现）、markdown
├── state/    # zustand 三切片：auth / sync / notes
├── storage/  # StorageAdapter（TauriFs / OPFS）——本地明文真相
├── crypto/   # keystore（唯一持密）+ envelope（无状态加解密）
├── sync/     # 同步引擎 + codec（编解码唯一出口）
├── ai/       # agent、tools（注册表）、llmTransport、sessionStore
└── features/ # FileTree / Editor / Chat / Login / StatusBar
```

六个扩展点（换实现只动这六处）：Keystore、`sync/codec`、SessionStore、LlmTransport、
StorageAdapter、工具注册表——详见 ARCHITECTURE §3 扩展点表。

**状态管理**：zustand 三个 slice；同步基线由 `sync/engine` 自持，slice 只存投影。
**依赖铁律**与**明确不做**（路由框架/DI/事件总线/Redux/service worker）见 ARCHITECTURE §3。

## 4. 服务端设计

### 4.1 职责边界

**保留**——只有四组接口：认证（开放注册、登录、续期、换口令、注销）、同步（manifest +
文件推拉 + 乐观锁，密文形态）、LLM 中继（OpenAI 兼容透传、零留存）、`/health`。

**明确不做**——文件编辑 API、搜索 API、聊天 API、会话查询 API；任何 Agent 逻辑；
任何对话归档、请求体日志、用户行为审计。

### 4.2 API 清单

唯一权威是 [API.md](API.md)（形状、错误码、限流配额）。分组：账户 `GET /api/auth/policy`、
`POST register/login/refresh/key`、`DELETE /api/auth/account`；同步 `GET /api/sync/manifest`、
`GET/PUT/DELETE /api/sync/file`；中继 `POST /api/ai/v1/chat/completions`；健康 `GET /health`。
除 `/health`、`policy`、`register`、`login` 外全部过 `require_user` 鉴权。

### 4.3 部署

- **完全分容器（唯一形态）**：服务端镜像纯 API；Web 客户端独立镜像（nginx 静态 +
  同源代理）；见 ARCHITECTURE §7；
- 两个卷：`/notes`（各用户密文仓库，全部密文）、`/data`（用户表 + protected_key，
  **必须备份**——丢失即无法登录/解锁，兜底靠用户手里的恢复密钥文件）；
- 桌面 `tauri build`；移动 Xcode / Android Studio；Web `vite build` 静态产物。

## 5. 同步协议

### 5.1 模型

- 服务端对每个用户的推送递增其**专属 `rev`**（不跨用户、不泄露活动）；
- 每文件一个内容 `hash`（sha256，**传输字节**即密文的哈希，见 §6.4）；
- 同步范围：全部 `.md`（含 `.trash/`）；命名空间按 token `sub`（不可变 uid）隔离。

### 5.2 流程

```
拉：GET manifest → 解密路径 → 与本地 diff → 逐个 GET file → 解密 → 写本地
推：本地变更（base_hash = 上次同步的密文哈希）→ 加密后 PUT file
    → 200 更新基线；409 → 下载服务端版本为基线，本地另存冲突副本
```

### 5.3 冲突处理（单文件级）

1. PUT 返回 409；2. 下载服务端版本作为新基线；
3. 本地未推送内容另存为 `名字 (冲突 YYYYMMDD-HHMM).md` 后正常推送副本；
4. 用户手动合并——**不做自动合并**（宁可笨而可见）；冲突副本就是普通笔记。

### 5.4 触发时机

保存后防抖推送（~2s）；回前台/聚焦/visibilitychange → 拉+推；手动「立即同步」；
状态栏常驻 待同步计数 / 同步中 / 离线。可选 SSE 推 `rev` 变更（后续候选）。

### 5.5 明确不做

CRDT/OT 协同（每账号独立命名空间）、git-backed 同步（候选）、增量二进制补丁（整文件推拉足够）。

## 6. 安全：零知识与端到端加密

### 6.1 保护边界

| 服务端可见（可接受） | 服务端不可见（必须） |
|---|---|
| 用户名、登录时间、token | **笔记正文**（AES-GCM 密文） |
| 密文 blob、密文哈希、`rev` | **文件路径与目录结构**（路径密文） |
| 密文大小（4KiB 对齐）、更新频率 | 口令、KEK、MK（全部只在客户端） |
| `protected_key`——一个打不开的信封 | 会话历史（仅客户端 IndexedDB） |
| LLM 对话明文（中继期间流过，**零留存**） | 恢复密钥 REK（仅用户持有） |

诚实的例外：**让 AI 读取某篇笔记时**，被读内容会作为对话上下文经中继发给 LLM（服务端转发瞬间可见，但不落存储）。
不使用 AI 时，笔记内容默认不出客户端。

### 6.2 密钥体系

```
口令 ──Argon2id(salt=H(上下文+用户名))──► root
  ├─ HKDF(root, "login") → L    登录凭证：发服务端，服务端只存 hash(L)
  └─ HKDF(root, "enc")   → KEK  只在客户端，解开服务端返回的信封
                                ▼
                    MK（随机 256bit，仅存内存，不落盘）
                    ├─ 内容密钥 → 笔记密文（AES-256-GCM）
                    ├─ 路径密钥 → 路径密文
                    └─ （预留）设备密钥 / 分享密钥

服务端保存：protected_key = AES-GCM(KEK, MK)   ← 打不开的信封，只负责存与还
用户保存：  REK 恢复密钥文件（wrap 了 L 与 MK）→ 忘记口令时的逃生舱
```

- **单口令**：同时派生登录凭证与加密密钥——登录即解锁（§6.3）；
- **MK 随机生成**：换口令只需重新封装信封，**笔记一个字节都不用重加密**；
- **Argon2id 挡离线爆破**：拖库者只有 `hash(L)` 与打不开的信封；
- **REK**：注册时导出一次、离线保存——零知识的固有代价（服务端帮不了你）的出口。

### 6.3 登录即解锁

```
用户输入用户名 + 口令（唯一一次输入）
  → 客户端本地：root = Argon2id(口令) → L = HKDF(root,"login")、KEK = HKDF(root,"enc")
  → POST /api/auth/login {username, password: L}
  ← 服务端：校验 hash(L) → {token, protected_key}
  → MK = 解开(protected_key, KEK) → 常驻内存 → 同步自动解锁
```

- 注册：本地生成 MK → `POST register {username, password: L, protected_key}`（注册即登录）；
- 多设备：同一口令 → 同一 KEK → 登录拿回信封 → 解锁，零额外步骤；
- 换口令：`PUT /api/auth/key` 只更新 hash(L) 与信封，**MK 不变 → 笔记密文不动**；
- 服务端从头到尾没见过口令、KEK、MK。

### 6.4 笔记加密（数据离开设备的边界）

- **信封格式**：`NC1 | nonce(12B) | 密文 | GCM tag(16B)`，外层 base64url 进 JSON（`NC1` 版本前缀，算法迁移新旧并行读）；
- **内容**：每次写入独立随机 nonce；**路径**：确定性加密（同一路径恒同一密文，服务端据此定位文件）；
- **hash = sha256(传输字节)**：即密文哈希——乐观锁与 `rev` 语义照旧，服务端不理解任何明文；
- **旁路掩蔽**：`size` 按 4KiB 块对齐；`mtime` 真实值进密文，manifest 只暴露按天舍入值；
- **本地永远明文**：加密只发生在同步编解码这一个边界上。

### 6.5 AI 对话的边界

中继必须把消息明文转发给外部 LLM（转发瞬间服务端可见），约束是：**零留存**——不归档、
不写请求体日志、无会话 API、不持会话状态；会话历史只在客户端 IndexedDB。
彻底不可见的前提是中继退役、客户端直连网关（§6.7）——即便如此模型提供方仍会看到对话。

### 6.6 已知泄露面（坦白列出）

- **流量分析**：密文大小（4KiB 对齐）与更新频率——自托管/小规模场景接受；
- **路径等值**：路径确定性加密 →「哪些文件被反复改名」的等值关系可见，内容不可见；
- **登录元数据**：登录时间、IP 等常规日志（不含请求体）。

### 6.7 演进方向

| 方向 | 触发条件 |
|------|----------|
| 直连网关（`GET /api/ai/config` + DirectTransport） | 中继零留存仍不满足需求 |
| 用户表换 SQLite/Postgres（只动 `UserStore`） | 用户数接近 ~10³ |
| 中继配额持久化 | 需要精确计费/审计 |
| 设备密钥 / 生物识别解锁（换 Keystore 实现） | 体验优化 |
| per-note 密钥分享 | 真实分享需求出现 |

## 7. 技术选型

| 层 | 选择 | 层 | 选择 |
|----|------|----|------|
| 跨平台壳 | Tauri 2（Rust） | 加密 | WebCrypto AES-256-GCM + Argon2id（WASM） |
| 前端 | React 19 + Vite 6 + TS | 会话存储 | IndexedDB（仅客户端） |
| 编辑器 | CodeMirror 6 | 本地存储 | Tauri fs / OPFS（不引入数据库） |
| 聊天 UI | @assistant-ui/react（演进接入，现自研同构循环） | LLM 接入 | 服务端中继；演进直连（收敛在 `llmTransport.ts`） |
| 状态 | zustand（三个 slice） | 后端 | Python 3.12+ / FastAPI（认证+同步+中继） |
| 样式 | 方案四 design tokens + fontsource | 打包 | Docker（server / web 双镜像）+ Tauri bundler + vite |

## 8. 里程碑

| # | 名称 | 出口标准 |
|---|------|----------|
| M1 | 本地优先 + 解锁 | 断网下全部本地功能可用；注册/登录即解锁 |
| M2 | AI 助手 + 中继 | AI 全功能在客户端，key 不出服务端；中继零留存，会话仅存本机 |
| M3 | 同步 + 零知识 | 两客户端双向同步，冲突产副本；打开服务器卷看不到任何明文（含路径） |
| M4 | Tauri 桌面 | 三桌面平台安装包，可编辑本地目录并同步 |
| M5 | 响应式 + 移动端 | 真机可用：编辑、同步、chat |
| M6 | 打磨 | ⌘K 面板、内链补全、自动更新、状态栏同步指示 |

> 每个里程碑结束均为可发布状态。M1–M3、M6（部分）已落地；M4 已出 Linux 包；
> 自动更新与移动端出包待签名证书与对应 OS 的 CI runner。
