"""共享契约类型：api / core / adapters 三方共用的数据形状。

★ 跨层类型的唯一来源：改协议形状只改本文件；
  api/schemas.py 只做 HTTP 序列化壳，客户端侧对应 client/web/src/sync/types.py。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ManifestEntry:
    path: str  # 路径密文（服务端看不到目录结构）
    hash: str  # 传输字节（密文）的 sha256
    mtime: float  # 粗粒度（按天舍入；真实值在密文内）
    size: int  # 密文长度（客户端已按 4KiB 对齐填充）


@dataclass(frozen=True)
class Manifest:
    rev: int
    files: list[ManifestEntry]


@dataclass(frozen=True)
class StoredFile:
    """同步副本中的单文件；content 为密文，hash = 密文的 sha256（DESIGN.md §6.4）。"""

    content: str
    hash: str
    mtime: float


@dataclass(frozen=True)
class Token:
    value: str
    subject: str  # sub = uid（注册时生成，永不改变）
    expires_at: float


@dataclass(frozen=True)
class User:
    """用户记录（API.md §8）；login_verifier 与 protected_key 仅在认证用例中使用。"""

    uid: str
    username: str
    created_at: float
