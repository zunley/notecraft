"""配置：全部来自环境变量（真实口令/密钥只存在于 .env，不入库）。

TODO:
- NOTE_MD_USERNAME / NOTE_MD_PASSWORD   单账号凭证（多用户演进见 DESIGN-V2 §6）
- NOTE_MD_TOKEN_TTL                     token 有效期（默认 72h）
- NOTE_MD_ROOT / NOTE_MD_DATA_DIR       笔记本同步副本 / 应用数据目录
- OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL   LLM 网关（仅中继使用）
"""
