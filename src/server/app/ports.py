"""端口（ports）：core 层依赖的接口契约（typing.Protocol）。

依赖倒置的接缝——DESIGN-V2 的所有演进切换点都落在这里（§6、§7）：

| 端口              | 本期实现（adapters/）        | 远期替换                         |
|-------------------|------------------------------|----------------------------------|
| Credentials       | EnvCredentials（env 单账号）  | 用户表 + 哈希口令（§6.2 ①）      |
| NoteStore         | FileNoteStore（明文同步副本）| 加密沙盒：只存密文（§5.6）       |
| LlmGateway        | HttpLlmGateway（中继透传）   | 二期直连网关 / 下发 key（§7）    |
| SessionArchive    | FsSessionArchive（data/ 卷） | 客户端加密上传或仅客户端留存（§7）|

core 只 import 本模块；adapters 实现本模块；由 main.py 注入装配。
"""

from typing import Protocol


class Credentials(Protocol):
    """凭据校验（远期换用户表时只换实现）。"""

    def verify(self, username: str, password: str) -> bool: ...


class NoteStore(Protocol):
    """服务端同步副本；subject = token sub，命名空间 <subject>/。

    TODO: 精确返回类型改用 Manifest 等模型（上移到本模块，api 与 core 共用）。
    """

    def manifest(self, subject: str) -> dict: ...
    def read(self, subject: str, path: str) -> dict | None: ...
    def write(self, subject: str, path: str, content: str, base_hash: str) -> dict: ...


class LlmGateway(Protocol):
    """OpenAI 兼容网关注入点：key 只存在于实现内部，经 core 之外永不下传。"""

    def stream(self, bearer: str, payload: dict): ...  # TODO: 流式响应类型（httpx 流封装）


class SessionArchive(Protocol):
    """会话归档介质；★ 无任何对外读取 API（D6）。"""

    def append(self, subject: str, conversation_id: str, record: dict) -> None: ...
