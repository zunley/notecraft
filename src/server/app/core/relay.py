"""LLM 中继用例：校验 token → 转发网关 → 流式回传 → 触发归档。

TODO:
- OpenAI 兼容透传，payload 不增删字段；流式经 ports.LlmGateway
- ★ key 只存在于 HttpLlmGateway 实现内部，core 不持有、不下发
- 每次请求按 conversation_id 归档（conversation_id 仅供分组，服务端无状态）
- 限速
- 依赖注入：__init__(gateway: LlmGateway, archive: SessionArchive)
"""
