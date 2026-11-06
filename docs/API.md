# notecraft 服务端接口设计

> 服务端 HTTP 接口的**唯一权威规格**：路径、请求/响应形状、错误码、限流与配额。
> 设计动机见 [DESIGN.md](DESIGN.md)；分层与代码落点见 [ARCHITECTURE.md](ARCHITECTURE.md)。
>
> **服务模型**：任何人可在服务端注册——每用户一个独立零知识命名空间
> （独立密文仓库、独立 rev、独立配额），用户间互不可见，服务端对任何用户内容零知识。

---

## 1. 通用约定

- **Base**：`{server}/api`，JSON（UTF-8），生产必须 HTTPS；
- **认证**：`Authorization: Bearer <token>`，除标注「免鉴权」外全部需要；
- **信封字段**：`password`、`protected_key`、`path`、`content` 均为 **base64url（无填充）**；
  二进制信封格式见 DESIGN.md §6.4（`NC1 | nonce | 密文 | tag`）；
- **`password` ≠ 口令**：它是客户端派生的登录凭证 `L`，服务端只存 `hash(L)`——口令永不出客户端（DESIGN.md §6.3）；
- **版本**：relay 路径的 `/v1` 是 OpenAI 兼容约定；其余接口破坏性变更时在 `/api` 后加版本段；
  manifest 带 `protocol` 字段供协商；
- **时间**：Unix 秒。

## 2. 错误模型

统一形状（`details` 可选）：

```json
{ "error": { "code": "invalid_credentials", "message": "..." } }
```

客户端在 `lib/api.ts` 统一翻译为本地领域错误（`lib/errors.ts`），功能层不接触 HTTP 状态码——
与服务端「core 抛领域错误、main.py 统一翻译」对称。

| HTTP | code | 触发 |
|------|------|------|
| 400 | `invalid_request` | 参数缺失 / 形状非法（信封字段非 base64url、username 不合法） |
| 401 | `invalid_credentials` | 登录、换口令、注销的凭证校验失败——**不区分用户是否存在**（防枚举） |
| 401 | `unauthorized` | 无 token / 验签失败 / 用户已注销（token 即时失效） |
| 403 | `registration_closed` | 注册策略 `closed`，或 invite 模式邀请码错误 |
| 404 | `not_found` | 同步文件不存在 |
| 409 | `conflict` | 同步乐观锁：`base_hash` 与服务端当前版本不符 |
| 409 | `username_taken` | 注册用户名已被占用（由注册限速兜底） |
| 413 | `payload_too_large` | 单文件超过 `NOTE_MD_FILE_MAX` |
| 429 | `rate_limited` | 注册/登录限速（带 `Retry-After` 头） |
| 429 | `relay_quota_exceeded` | 中继当日配额用尽，`details.reset_at` = 次日零点（Unix 秒） |
| 503 | `upstream_unavailable` | LLM 网关未配置（`OPENAI_BASE_URL`/`OPENAI_API_KEY` 缺失） |
| 507 | `storage_quota_exceeded` | 用户存储配额用尽 |

上游 LLM 网关的错误**原样透传**（保持 OpenAI 错误形状），不包进本错误模型。

## 3. 账户与认证

### GET /api/auth/policy — 免鉴权

```json
200 { "registration": "open" }    // open（默认）| invite | closed
```

### POST /api/auth/register — 免鉴权（限速）

```json
请求  { "username": "alice", "password": "<base64url(L)>",
        "protected_key": "<base64url(信封)>", "invite": "<可选>" }
响应  201 { "token": "...", "expires_at": 1765432100 }
```

- `username`：`^[a-z0-9][a-z0-9_-]{2,31}$`（小写，唯一，仅作登录句柄，**不进任何路径**）；
- 注册即登录：客户端此刻已持有 MK，无需回传 `protected_key`；
- 落盘 `{uid, username, hash(L), protected_key, created_at}`——零知识，拖库也读不到笔记；
- 防抢注：按 IP 限速 + 注册策略（`NOTE_MD_REGISTRATION`）；**无管理员接口**（运营直接操作服务器文件系统）。

### POST /api/auth/login — 免鉴权（限速）

```json
请求  { "username": "alice", "password": "<base64url(L)>" }
响应  200 { "token": "...", "expires_at": ..., "protected_key": "<base64url(信封)>" }
```

- 校验 `hash(L)` → 签发 token（payload `{sub: uid}`）→ `protected_key` 供 KEK 解封 MK；
- 凭证错误一律 `401 invalid_credentials`（防枚举）。

### POST /api/auth/refresh — 需认证

```json
响应  200 { "token": "...", "expires_at": ... }   // sub 不变；续期不需要口令
```

### PUT /api/auth/key — 需认证

```json
请求  { "password": "<旧 L>", "new_password": "<新 L>", "new_protected_key": "<新信封>" }
响应  204
```

- 必须携带**旧** `password`（防止 token 被盗者把账号改锁死）；
- 只更新 `hash(L)` 与信封；**MK 不变 → 笔记密文一个字节都不动**。

### DELETE /api/auth/account — 需认证

```json
请求  { "password": "<L>" }      响应  204
```

删除账号记录与 `/notes/<uid>/` 全部密文，不可恢复；该用户所有 token 即时失效。

## 4. 同步

全部需认证；命名空间 = token `sub`（uid）；**服务端只见密文**（path 与 content 均为信封）。

### GET /api/sync/manifest

```json
200 { "protocol": 1, "rev": 42,
      "files": [ { "path": "<base64url(路径密文)>", "hash": "...",
                   "mtime": 1765400000, "size": 8192 } ] }
```

- **`rev` 为该用户专属计数器**（只有该用户自己的推送会推进它）；
- `hash` = 传输字节（密文）的 sha256；`size` = 密文字节（客户端已按 4KiB 对齐）；
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
- 新建时 `base_hash` 为空串；超单文件上限 → `413`；超用户存储配额 → `507`；成功后 `rev` +1。

### DELETE /api/sync/file?path=<base64url>&base_hash=<hash>

```json
204        // 幂等：文件不存在也返回 204
409 conflict   // base_hash 不符
```

与写入同样的乐观锁语义，防止误删他人设备刚更新的版本。

## 5. LLM 中继

### POST /api/ai/v1/chat/completions — 需认证

- **OpenAI 兼容透传**（含流式 SSE），请求体与响应形状服务端不增删字段；
- **零留存**：不归档、不记请求体、不持会话状态；访问日志仅 method / path / status / 耗时 / uid；
- **每用户日配额**：每次中继请求计 1（无论上游成败），超限 `429 relay_quota_exceeded`
  + `Retry-After` + `details.reset_at`；
- 上游 key 只注入在服务端适配器内部，永不下发。

**预留（当前不实现）**：`GET /api/ai/config` —— 直连网关时下发网关地址与密钥。

## 6. 健康检查

### GET /health — 免鉴权

```json
200 { "status": "ok" }
```

## 7. 限流与配额（配置汇总）

全部有代码默认值，环境变量只在需要覆盖时设置（`.env.example` 占位，不入库）：

| 项 | 默认 | 环境变量 | 超限表现 |
|----|------|------|----------|
| 注册策略 | `open` | `NOTE_MD_REGISTRATION`（open/invite/closed） | 403 `registration_closed` |
| 邀请码 | — | `NOTE_MD_INVITE_CODE` | 403 |
| 注册/登录限速 | 10 次/分/IP（登录另按 username 限速） | `NOTE_MD_AUTH_RATE` | 429 `rate_limited` |
| 单文件上限 | 1 MiB 密文 | `NOTE_MD_FILE_MAX` | 413 |
| 每用户存储 | 1 GiB 密文 | `NOTE_MD_STORAGE_QUOTA` | 507 |
| 中继日配额 | 200 次/天/用户 | `NOTE_MD_RELAY_DAILY_QUOTA` | 429 `relay_quota_exceeded` |
| token TTL | 72h | `NOTE_MD_TOKEN_TTL` | 过期后 401，refresh 续期 |
| CORS 白名单 | 关闭 | `NOTE_MD_ALLOWED_ORIGINS`（逗号分隔，支持 `*`） | 仅跨源直连时需要 |

实现落点（ARCHITECTURE.md §4 分层规则）：按 IP 限速在 `main.py` 中间件；按 username 限速在
core 层；中继配额走 `RelayQuota` 端口（本期内存计数）；存储配额由 `NoteStore` 自管。

## 8. 多用户数据模型

```
/data/users/<uid>.json     # {uid, username, login_verifier, protected_key, created_at}
/data/users/by-username/<username> → uid   # 小写唯一索引（不进任何路径）
/notes/<uid>/meta.json     # {rev, files:{路径密文: {hash, mtime, size, bytes}}}
/notes/<uid>/files/<路径密文>  # 密文 blob
```

- **`uid`**：注册时生成的随机 16 字节 hex，**永不变**，token `sub` 与目录名都用它；
  `require_user` 验签后确认用户仍存在——注销即令全部旧 token 失效；
- **隔离不变式**：所有业务读写都经 `require_user` 取 `sub`，`NoteStore`/`UserStore`
  每个方法第一参数即 `subject`——**代码里不存在跨租户的路径**；
- **扩容**：文件版用户表到约 10³ 用户足够；更大只换 `UserStore` 实现（ports 接缝已留）；
- 服务端无跨用户共享状态（token 无状态、relay 无会话、rev 按用户），
  多实例部署只需共享卷，无会话粘性问题。
