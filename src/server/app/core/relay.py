"""LLM 透传（纯转发）——★ 服务端不含任何 Agent 逻辑。

AI Agent 从第一阶段起 100% 运行在客户端（D3）：工具循环、14 个文件工具、
prompt 组装、write-gate、对话上下文管理全部在前端；服务端 /api/ai/v1/*
自始至终只是 OpenAI 兼容的透明转发（D4）。本模块只做两件事：

- 转发：payload 原样经 ports.LlmGateway 透传（key 注入收敛在适配器内部）
- 副产品归档：透传的往返记录追加到归档介质（无对外读取 API，D6）

不组装 prompt、不执行工具、不持会话状态——本文件永远不应出现此类代码。

TODO:
- 流式透传；限速
- 依赖注入：__init__(gateway: LlmGateway, archive: SessionArchive)
"""
