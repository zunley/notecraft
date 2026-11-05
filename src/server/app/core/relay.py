"""LLM 透传（纯转发）——★ 服务端不含任何 Agent 逻辑，且零留存（DESIGN.md §6.5）。

AI Agent 100% 运行在客户端：工具循环、文件工具、prompt 组装、write-gate、
对话上下文管理全部在前端；服务端 /api/ai/v1/* 自始至终只是 OpenAI 兼容的
透明转发。本模块只做两件事：

- 转发：payload 原样经 ports.LlmGateway 透传（key 注入收敛在适配器内部）
- 零留存：转发即消失——不归档、不记录请求体、不持会话状态
  （会话历史由客户端 ai/sessionStore 存 IndexedDB，服务端无从获取）

不组装 prompt、不执行工具、不持会话状态——本文件永远不应出现此类代码。

TODO:
- 配额：RelayQuota.take(uid) 耗尽 → RateLimitError（429 + Retry-After + details.reset_at，API.md §5）
- 流式透传；限速（只记 method/path/status/耗时/uid，不记 body）
- 依赖注入：__init__(gateway: LlmGateway, quota: RelayQuota)
"""
