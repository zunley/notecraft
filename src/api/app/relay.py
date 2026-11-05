"""LLM 中继：OpenAI 兼容透传（httpx 流式），key 永不下发客户端。

TODO:
- POST /api/ai/v1/chat/completions
  校验用户 token → 注入 OPENAI_API_KEY → 转发网关 → 流式回传
- 按 conversation_id 归档对话（见 archive.py；conversation_id 仅供归档分组）
- 限速；预留意图为二期 GET /api/ai/config（DirectTransport，见 DESIGN-V2 §7）
"""
