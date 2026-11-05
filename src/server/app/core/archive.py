"""透传归档用例：LLM 转发的副产品，写 DATA_DIR/sessions/。

归档的是「透传往返记录」（转发日志性质）：★ 服务端不理解、不编排对话，
Agent 逻辑全在客户端（D3/D6）。

TODO:
- 按 conversation_id 追加：时间戳、透传的 messages、流式回复
  （粒度开工时定：仅 LLM 往返 or 含客户端工具摘要，DESIGN-V2 未决项 3）
- ★ 无任何对外 API：客户端不请求、不展示会话记录
- 归档介质走 ports.SessionArchive（本期 FsSessionArchive，二期可换加密上传）
- 依赖注入：__init__(archive: SessionArchive)
"""
