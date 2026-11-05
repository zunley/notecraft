"""共享契约类型：api / core / adapters 三方共用的数据形状。

★ 跨层类型的唯一来源：改协议形状只改本文件；
  api/schemas.py 只做 HTTP 序列化壳，客户端侧对应 client/web/src/sync/types.ts。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ManifestEntry:
    path: str
    hash: str
    mtime: float
    size: int


@dataclass(frozen=True)
class Manifest:
    rev: int
    files: list[ManifestEntry]


@dataclass(frozen=True)
class StoredFile:
    """同步副本中的单文件；hash = 传输字节的 sha256（加密留缝，§5.6）。"""

    content: str
    hash: str
    mtime: float


@dataclass(frozen=True)
class Token:
    value: str
    subject: str  # sub：命名空间与归档的用户身份
    expires_at: float


@dataclass(frozen=True)
class ChatRecord:
    """会话归档记录（粒度见 DESIGN-V2 未决项 3）。"""

    conversation_id: str
    messages: list[dict]  # TODO: 需要收紧时再换具体模型
