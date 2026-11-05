"""领域错误：core 抛出，api 层统一翻译为 HTTP 状态码（异常处理器在 main.py 注册）。

形状与状态码映射以 docs/API.md §2 为准——新增错误先查该表，不重复发明语义。
"""


class DomainError(Exception):
    """领域错误基类。"""


class AuthError(DomainError):
    """凭证错误 / token 无效或过期 → 401（不区分用户是否存在，防枚举）。"""


class RegistrationClosedError(DomainError):
    """注册策略 closed 或邀请码错误 → 403。"""


class NotFoundError(DomainError):
    """路径不存在 → 404。"""


class ConflictError(DomainError):
    """乐观锁冲突（base_hash 不符）/ username 已被占用 → 409；
    同步冲突副本由客户端处理（DESIGN.md §5.3）。"""


class UsernameTakenError(ConflictError):
    """注册用户名已占用 → 409 username_taken。"""


class PayloadTooLargeError(DomainError):
    """单文件超 NOTE_MD_FILE_MAX → 413。"""


class RateLimitError(DomainError):
    """注册/登录限速 → 429（带 Retry-After）；details 可带 reset_at。"""

    def __init__(self, retry_after: int | None = None):
        super().__init__("rate limited")
        self.retry_after = retry_after


class QuotaExceededError(DomainError):
    """用户存储配额用尽 → 507。"""
