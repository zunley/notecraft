"""Pydantic 请求/响应模型——只做 HTTP 序列化壳。

★ 业务/契约类型见 app/types.py（跨层唯一来源）；本文件不定义领域形状，
  只负责 wire 格式（如 LoginRequest / TokenResponse / Manifest 的 JSON 形状）。

TODO:
- auth：LoginRequest / TokenResponse
- sync：Manifest / FilePutRequest / FileResponse 的 wire 形状（对应 types.py）
- relay：透传体保持 OpenAI 兼容形状，服务端不增删字段
"""
