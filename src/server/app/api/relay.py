"""LLM 中继路由（薄壳，OpenAI 兼容透传）。

TODO:
- POST /api/ai/v1/chat/completions
  校验用户 token → core.relay 转发（httpx 流式）→ 响应透传；同时归档对话
- 预留意图为二期 GET /api/ai/config（DirectTransport，见 DESIGN-V2 §7）
"""
