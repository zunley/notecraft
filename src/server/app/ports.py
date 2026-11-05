"""端口（ports）：core 层依赖的接口契约（typing.Protocol）。

依赖倒置的接缝——全部演进切换点都落在这里（接口规格见 docs/API.md）：

| 端口        | 本期实现（adapters/）                | 远期替换                    |
|-------------|--------------------------------------|-----------------------------|
| UserStore   | FileUserStore（/data：每用户记录）   | SQLite/Postgres（~10³ 用户）|
| NoteStore   | FileNoteStore（密文 blob，<uid>/ 分片）| 无需替换——密文即常态        |
| LlmGateway  | HttpLlmGateway（中继透传）           | 直连网关启用后中继退役      |
| RelayQuota  | MemRelayQuota（内存日计数）          | 持久化计数（精确计费时）    |

★ 零知识边界：服务端只见过登录凭证的哈希与打不开的 protected_key，
  从未见过口令/KEK/MK；NoteStore 只做 blob 存取，不理解任何明文语义。
★ 多租户边界：所有方法第一参数即 subject（uid）——代码里不存在跨租户的路径。

core 只 import 本模块；adapters 实现本模块；由 main.py 注入装配。
契约类型见 types.py；失败语义见 errors.py（core 抛出，api 统一翻译）。
"""

from typing import AsyncIterator, Protocol

from .types import Manifest, StoredFile, User

# 流式响应：OpenAI 兼容透传的字节流（SSE）
Stream = AsyncIterator[bytes]


class UserStore(Protocol):
    """用户表（API.md §3/§8）。

    每用户记录：{uid, username, login_verifier(hash(L)), protected_key, created_at}。
    uid 注册时生成、永不改变；username 小写唯一，仅作登录句柄，不进任何路径。
    """

    def create(self, username: str, password: str, protected_key: str) -> User:
        """注册；username 已存在时抛 errors.UsernameTakenError。
        可选 invite 校验由 core 层完成（策略读 config），本方法只管落盘。"""
        ...

    def verify(self, username: str, password: str) -> tuple[str, str] | None:
        """校验登录凭证，成功返回 (uid, protected_key)，失败返回 None。"""
        ...

    def get(self, uid: str) -> User | None:
        """按 uid 取用户——require_user 验签后确认用户仍存在（注销即 token 失效）。"""
        ...

    def put_key(self, uid: str, password: str, protected_key: str) -> None:
        """换口令：更新凭证哈希与信封（MK 不变，笔记密文不动）。"""
        ...

    def delete(self, uid: str) -> None:
        """注销：删除用户记录（密文仓库由 NoteStore 删除）。"""
        ...


class NoteStore(Protocol):
    """服务端同步副本；subject = uid，命名空间 <uid>/。

    content 与 path 均为客户端加密后的传输字节——只存 blob、只比 hash。
    自管每用户 rev 与字节统计（配额判定）。
    """

    def manifest(self, subject: str) -> Manifest: ...
    def read(self, subject: str, path: str) -> StoredFile | None: ...

    def write(self, subject: str, path: str, content: str, base_hash: str) -> StoredFile:
        """乐观锁：base_hash 不符抛 errors.ConflictError；
        超单文件上限抛 errors.PayloadTooLargeError；超配额抛 errors.QuotaExceededError。"""
        ...

    def delete(self, subject: str, path: str, base_hash: str) -> None:
        """删除（幂等）；base_hash 不符抛 errors.ConflictError。"""
        ...

    def purge(self, subject: str) -> None:
        """注销时清空该用户全部密文。"""
        ...


class LlmGateway(Protocol):
    """OpenAI 兼容网关注入点：key 只存在于实现内部，经 core 之外永不下传。

    payload 为透传体（不增删字段）；超时/重试/上游错误形状收敛在实现内。
    ★ 零留存（DESIGN.md §6.5）：转发即消失，不归档、不记请求体。
    """

    def stream(self, payload: dict) -> Stream: ...


class RelayQuota(Protocol):
    """中继日配额（API.md §5/§7）：按 uid 计数，超限由 core 抛 RateLimitError。"""

    def take(self, subject: str) -> bool:
        """尝试消耗 1 次当日额度；成功 True，超限 False。"""
        ...

    def reset_at(self, subject: str) -> int:
        """当日配额重置时间（次日零点 Unix 秒），供 429 details 使用。"""
        ...
