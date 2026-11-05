"""端口（ports）：core 层依赖的接口契约（typing.Protocol）。

依赖倒置的接缝——DESIGN-V2 的所有演进切换点都落在这里（§6、§7）：

| 端口              | 本期实现（adapters/）        | 远期替换                         |
|-------------------|------------------------------|----------------------------------|
| Credentials       | EnvCredentials（env 单账号）  | 用户表 + 哈希口令（§6.2 ①）      |
| NoteStore         | FileNoteStore（明文同步副本）| 加密沙盒：只存密文（§5.6）       |
| LlmGateway        | HttpLlmGateway（中继透传）   | 二期直连网关 / 下发 key（§7）    |
| SessionArchive    | FsSessionArchive（data/ 卷） | 客户端加密上传或仅客户端留存（§7）|

core 只 import 本模块；adapters 实现本模块；由 main.py 注入装配。
契约类型见 types.py；失败语义见 errors.py（core 抛出，api 统一翻译）。
"""

from typing import AsyncIterator, Protocol

from .types import Manifest, RelayRecord, StoredFile

# 流式响应：OpenAI 兼容透传的字节流（SSE）
Stream = AsyncIterator[bytes]


class Credentials(Protocol):
    """凭据校验（远期换用户表时只换实现）。"""

    def verify(self, username: str, password: str) -> bool: ...


class NoteStore(Protocol):
    """服务端同步副本；subject = token sub，命名空间 <subject>/。"""

    def manifest(self, subject: str) -> Manifest: ...
    def read(self, subject: str, path: str) -> StoredFile | None: ...

    def write(self, subject: str, path: str, content: str, base_hash: str) -> StoredFile:
        """乐观锁：base_hash 不符时抛 errors.ConflictError。"""
        ...


class LlmGateway(Protocol):
    """OpenAI 兼容网关注入点：key 只存在于实现内部，经 core 之外永不下传。

    payload 为透传体（不增删字段）；超时/重试/上游错误形状收敛在实现内。
    """

    def stream(self, payload: dict) -> Stream: ...


class SessionArchive(Protocol):
    """透传归档介质（转发日志性质）；★ 无任何对外读取 API（D6）。"""

    def append(self, subject: str, record: RelayRecord) -> None: ...
