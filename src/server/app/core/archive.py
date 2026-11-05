"""会话归档用例：中继副产品，写 DATA_DIR/sessions/。

TODO:
- 按 conversation_id 追加：时间戳、用户消息、AI 回复、工具调用摘要
  （粒度开工时定：仅 LLM 往返 or 含客户端工具摘要，DESIGN-V2 未决项 3）
- ★ 无任何对外 API：客户端不请求、不展示会话记录（D6）
- 归档介质走 ports.SessionArchive（本期 FsSessionArchive，二期可换加密上传）
- 依赖注入：__init__(archive: SessionArchive)
"""
