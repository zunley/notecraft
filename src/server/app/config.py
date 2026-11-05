"""配置：全部来自环境变量（真实值只在 .env，不入库；默认值见 docs/API.md §7）。

TODO:
- NOTE_MD_REGISTRATION         注册策略 open（默认）/ invite / closed
- NOTE_MD_INVITE_CODE          invite 模式下的邀请码（可选）
- NOTE_MD_AUTH_RATE            注册/登录限速，次/分/IP（默认 10）
- NOTE_MD_FILE_MAX             单文件密文上限（默认 1 MiB）
- NOTE_MD_STORAGE_QUOTA        每用户存储配额（默认 1 GiB）
- NOTE_MD_RELAY_DAILY_QUOTA    中继日配额（默认 200 次/天/用户）
- NOTE_MD_TOKEN_TTL            token 有效期（默认 72h）
- NOTE_MD_ROOT / NOTE_MD_DATA_DIR   /notes 密文仓库（<uid>/ 分片）/ 用户表目录
- OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL   LLM 网关（仅中继使用，不下发）

★ 没有 NOTE_MD_USERNAME / NOTE_MD_PASSWORD：口令只在客户端派生（DESIGN.md §6.3），
  服务端只存登录凭证哈希，由 /api/auth/register 写入 /data。
  ★ 没有任何「管理员凭证」：运营操作直接在服务器文件系统进行，不为管理后台开接口。
"""
