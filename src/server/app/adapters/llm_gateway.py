"""LlmGateway 实现：httpx 流式转发到 OpenAI 兼容网关。

★ OPENAI_API_KEY 只存在于本实现内部，注入上游请求头，永不出现在
  core/api 响应或下发给客户端的任何数据中。

TODO: 实现 ports.LlmGateway.stream：注入 key → POST {OPENAI_BASE_URL}/chat/completions
  → 流式透传（SSE）；上游不可用/超时的错误形状保持 OpenAI 兼容。
直连网关（DirectTransport，DESIGN.md §6.7）启用后，本适配器随中继一并退役。
"""


# TODO: class HttpLlmGateway:
#     def __init__(self, base_url: str, api_key: str, model: str): ...
#     def stream(self, bearer: str, payload: dict): ...
