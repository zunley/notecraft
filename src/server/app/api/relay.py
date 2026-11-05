"""LLM 中继路由（薄壳，OpenAI 兼容透传）。零留存纪律见 DESIGN.md §6.5。

TODO:
- POST /api/ai/v1/chat/completions
  校验用户 token → core.relay 转发（httpx 流式）→ 响应透传。
  ★ 零留存：不归档、不记请求体、不持会话状态——转发即消失
- 预留（直连网关时实现）GET /api/ai/config（DirectTransport，DESIGN.md §6.7）
"""
