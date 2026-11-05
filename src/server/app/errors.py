"""领域错误：core 抛出，api 层统一翻译为 HTTP 状态码（异常处理器在 main.py 注册）。

只保留三类——新的错误形状等真实需求出现再加（YAGNI）。
"""


class DomainError(Exception):
    """领域错误基类。"""


class AuthError(DomainError):
    """凭证错误 / token 无效或过期 → 401。"""


class NotFoundError(DomainError):
    """路径不存在 → 404。"""


class ConflictError(DomainError):
    """乐观锁冲突（base_hash 不符）→ 409；冲突副本由客户端处理（§5.3）。"""
