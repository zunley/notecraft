# notecraft 服务端接口设计

> 本文是服务端 HTTP 接口的**唯一权威规格**：路径、请求/响应形状、错误码、限流与配额。
> 为什么这样设计见 [DESIGN.md](DESIGN.md)（§4 服务端、§6 安全模型）；
> 分层与代码落点见 [ARCHITECTURE.md](ARCHITECTURE.md)。
>
> **服务模型**：任何安装 notecraft 的人都可在服务端**注册**自己的账号——
> 每用户一个独立的零知识命名空间（独立密文仓库、独立 rev、独立配额），用户之间互不可见，
> 服务端对任何用户的内容零知识。

---

## 1. 通用约定

- **Base**：`{server}/api`，JSON（UTF-8），生产必须 HTTPS；
- **认证**：`Authorization: Bearer <token>`。除标注「免鉴权」的端点外全部需要；
- **信封字段**：`password`、`protected_key`、`path`、`content` 均为
  **base64url（RFC 4648 §5，无填充）**——query 中的 `path` 无需再转义；
  二进制信封格式见 DESIGN.md §6.4（`NC1 | nonce | 密文 | tag`）；
- **`password` 字段不是口令本身**：它是客户端本地派生的登录凭证 `L`
  （Argon2id → HKDF 分支），服务端只存 `hash(L)`——口令永不出客户端（DESIGN.md §6.3）；
- **版本**：relay 路径的 `/v1` 是 OpenAI 兼容约定，与本项目版本无关；
  其余接口破坏性变更时在 `/api` 后加版本段；manifest 带 `protocol` 字段供客户端协商；
- **时间**：Unix 秒。

## 2. 错误模型

所有错误响应统一形状：

```json
{ "error": { "code": "invalid_credentials", "message": "..." } }
```

`details` 可选，随错误码附带机器可用的补充信息。

客户端在 `lib/api.ts` 把这些错误统一翻译为本地领域错误（`lib/errors.ts`），
功能层只 catch 领域错误、不接触 HTTP 状态码——与服务端「core 抛领域错误、api 翻译」对称。

| HTTP | code | 触发 |
|------|------|------|
| 400 | `invalid_request` | 参数缺失 / 形状非法（含信封字段非 base64url、username 不合法） |
| 401 | `invalid_credentials` | 登录、换口令、注销的凭证校验失败——**不区分用户是否存在**（防枚举） |
| 401 | `unauthorized` | 无 token / 验签失败 / 用户已注销（token 即时失效） |
| 403 | `registration_closed` | 注册策略为 `closed`，或 `invite` 模式下邀请码错误 |
| 404 | `not_found` | 同步文件不存在 |
| 409 | `conflict` | 同步乐观锁：`base_hash` 与服务端当前版本不符 |
| 409 | `username_taken` | 注册用户名已被占用（接受此枚举面，由注册限速兜底） |
| 413 | `payload_too_large` | 单文件超过 `NOTE_MD_FILE_MAX` |
| 429 | `rate_limited` | 注册/登录限速（带 `Retry-After` 头） |
| 429 | `relay_quota_exceeded` | 中继当日配额用尽，`details.reset_at` = 次日零点（Unix 秒） |
| 507 | `storage_quota_exceeded` | 用户存储配额用尽 |

上游 LLM 网关的错误**原样透传**（保持 OpenAI 错误形状），不包进本错误模型。

## 3. 账户与认证

### GET /api/auth/policy — 免鉴权

客户端据此决定显示「登录」还是「登录 + 创建账号」。

```json
200 { "registration": "open" }
```

`registration`: `open`（默认）| `invite`（需邀请码）| `closed`（仅已有账号可登录）。

### POST /api/auth/register — 免鉴权（限速）

```json
请求  { "username": "alice", "password": "<base64url(L)>",
        "protected_key": "<base64url(信封)>", "invite": "<可选>" }
响应  201 { "token": "...", "expires_at": 1765432100 }
```

- `username`：`^[a-z0-9][a-z0-9_-]{2,31}$`（小写，唯一，仅作登录句柄，**不进任何路径**）；
- 注册即登录：直接返回 token。客户端此刻已持有 MK（刚在本地生成），无需回传 `protected_key`；
- 服务端落盘：`{uid, username, hash(L), protected_key, created_at}`——零知识，拖库也读不到笔记；
- 防抢注：按 IP 限速 + 注册策略（`NOTE_MD_REGISTRATION`）；
- **无管理员概念**——运营者直接在服务器文件系统操作，不为管理后台增加任何接口。

### POST /api/auth/login — 免鉴权（限速）

```json
请求  { "username": "alice", "password": "<base64url(L)>" }
响应  200 { "token": "...", "expires_at": ..., "protected_key": "<base64url(信封)>" }
```

- 校验 `hash(L)` → 签发 token（payload `{sub: uid}`）→ 返回 `protected_key` 供 KEK 解封 MK（登录即解锁）；
- 凭证错误一律 `401 invalid_credentials`（不泄露用户是否存在）。

### POST /api/auth/refresh — 需认证

```json
响应  200 { "token": "...", "expires_at": ... }   // 新 token 值，sub 不变
```

续期不需要口令；token 过期只影响同步与中继，本地编辑不受影响。

### PUT /api/auth/key — 需认证

```json
请求  { "password": "<旧 L>", "new_password": "<新 L>", "new_protected_key": "<新信封>" }
响应  204
```

- 必须携带**旧** `password`——防止 token 被盗者用垃圾信封把账号「改锁死」；
- 服务端只更新 `hash(L)` 与信封；**MK 不变 → 笔记密文一个字节都不动**（DESIGN.md §6.3）。

### DELETE /api/auth/account — 需认证

```json
请求  { "password": "<L>" }
响应  204
```

删除账号记录与 `/notes/<uid>/` **全部密文**，不可恢复；该用户所有 token 即时失效。
零知识下服务端无法提供「找回」——客户端负责二次确认（并检查用户已导出 REK 恢复密钥）。

## 4. 同步

全部需认证；命名空间 = token `sub`（uid）；**服务端只见密文**（path 与 content 均为信封）。

### GET /api/sync/manifest

```json
200 { "protocol": 1, "rev": 42,
      "files": [ { "path": "<base64url(路径密文)>", "hash": "...",
                   "mtime": 1765400000, "size": 8192 } ] }
```

- **`rev` 为该用户专属计数器**：只有该用户自己的推送会推进它，
  既不被他人干扰，也不泄露跨用户活动（DESIGN.md §5.1）；
- `hash` = 传输字节（密文）的 sha256；`size` = 密文字节（客户端已按 4KiB 对齐填充）；
- `mtime` = 按天舍入的秒级时间戳（真实值在密文内）。

### GET /api/sync/file?path=<base64url>

```json
200 { "content": "<base64url(内容密文)>", "hash": "...", "mtime": ... }
404 not_found
```

### PUT /api/sync/file

```json
请求  { "path": "...", "content": "...", "base_hash": "上次同步的密文哈希" }
响应  200 { "hash": "...", "rev": 43 }
```

- `base_hash` 不符 → `409 conflict`（客户端下载服务端版本为基线，本地另存冲突副本）；
- 超单文件上限 → `413`；超用户存储配额 → `507`；
- 成功后 `rev` +1。

### DELETE /api/sync/file?path=<base64url>&base_hash=<hash>

```json
204        // 幂等：文件不存在也返回 204
409 conflict   // base_hash 不符
```

删除与重命名的服务端侧原语（本地 `move` 到 `.trash/` 后，旧路径由此消失）；
带 `base_hash` 是为了与写入同样的乐观锁语义，防止误删他人设备刚更新的版本。

## 5. LLM 中继

### POST /api/ai/v1/chat/completions — 需认证

- **OpenAI 兼容透传**（含流式 SSE），请求体与响应形状服务端不增删字段；
- **零留存**：不归档、不记请求体、不持会话状态；访问日志仅 method / path / status / 耗时 / uid；
- **每用户日配额**：每次中继请求计 1（无论上游成败），超限
  `429 relay_quota_exceeded` + `Retry-After` + `details.reset_at`；
- 上游 key 只注入在服务端适配器内部，永不下发热。

**预留（当前不实现）**：`GET /api/ai/config` —— 直连网关（DirectTransport）时下发网关地址与密钥。

## 6. 健康检查

### GET /health — 免鉴权

```json
200 { "status": "ok" }
```

## 7. 限流与配额（配置汇总）

全部有代码默认值，环境变量只在需要覆盖时设置（`.env.example` 占位，不入库）：

| 项 | 默认 | 环境变量 | 超限表现 |
|----|------|----------|----------|
| 注册策略 | `open` | `NOTE_MD_REGISTRATION`（open/invite/closed） | 403 `registration_closed` |
| 邀请码 | — | `NOTE_MD_INVITE_CODE` | 403 |
| 注册/登录限速 | 10 次/分/IP（登录另按 username 限速） | `NOTE_MD_AUTH_RATE` | 429 `rate_limited` |
| 单文件上限 | 1 MiB 密文 | `NOTE_MD_FILE_MAX` | 413 |
| 每用户存储 | 1 GiB 密文 | `NOTE_MD_STORAGE_QUOTA` | 507 |
| 中继日配额 | 200 次/天/用户 | `NOTE_MD_RELAY_DAILY_QUOTA` | 429 `relay_quota_exceeded` |
| token TTL | 72h | `NOTE_MD_TOKEN_TTL` | 过期后 401，refresh 续期 |

实现落点（对应 ARCHITECTURE.md 分层规则）：

- **按 IP 限速**：`main.py` 中间件（横切能力统一挂组装根）；
- **按 username 限速**（登录/注册）：core 层——只有读了 body 才拿得到 username；
- **中继配额**：`RelayQuota` 端口（Protocol），本期内存计数实现（重启清零，可接受），
  需持久化时只换 adapters 实现；
- **存储配额**：`NoteStore` 自管（它本就维护命名空间字节统计），超限抛 `StorageQuotaError`。

## 8. 多用户数据模型

```
/data/users/<uid>.json     # 账号：{uid, username, login_verifier, protected_key, created_at}
/notes/<uid>/<path密文>     # 该用户的密文仓库 + 命名空间元数据（rev、字节统计）
```

- **`uid`**：注册时生成的随机 16 字节 hex，**永不变**，token `sub` 与目录名都用它；
  `require_user` 验签后确认用户仍存在——注销即令全部旧 token 失效；
- **`username`**：小写唯一索引，仅作登录句柄——不进路径，因此改名、注销重注册都不会牵动数据布局；
- **隔离不变式**：所有业务读写都经 `require_user` 取 `sub`，`NoteStore`/`UserStore`
  每个方法第一参数即 `subject`——**代码里不存在跨租户的路径**；
- **扩容**：文件版用户表到约 10³ 用户足够；更大换 SQLite/Postgres
  只动 `UserStore` 实现（ports 接缝已留），协议与客户端零改动；
- 服务端无任何跨用户共享状态（token 无状态、relay 无会话、rev 按用户），
  因此多实例部署只需共享卷，无会话粘性问题。
