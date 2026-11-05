"""会话归档（原 v1 sessions.py 改造）：中继对话写入 DATA_DIR/sessions/。

TODO:
- 按 conversation_id 追加：时间戳、用户消息、AI 回复、工具调用摘要
  （归档粒度开工时定：仅 LLM 往返 or 含客户端工具摘要，见 DESIGN-V2 未决项 3）
- ★ 无任何对外 API：客户端不请求、不展示会话记录（D6）
- 归档是中继的副产品，仅供服务端排障与审计
"""
