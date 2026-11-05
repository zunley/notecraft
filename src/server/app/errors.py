"""领域错误：core 抛出，api 层统一翻译为 HTTP 状态码（异常处理器在 main.py 注册）。

形状与状态码映射以 docs/API.md §2 为准——新增错误先查该表，不重复发明语义。
每个错误类自带 (status, code)：翻译只有一个来源，api/main 不做 if-elif 分支。
"""

from __future__ import annotations


class DomainError(Exception):
    """领域错误基类。"""

    status: int = 500
    code: str = "internal_error"

    def details(self) -> dict | None:
        """机器可用的补充信息（随错误码附带，可为 None）。"""
        return None


class InvalidRequestError(DomainError):
    """参数缺失 / 形状非法（含信封字段非 base64url、username 不合法）→ 400。"""

    status = 400
    code = "invalid_request"


class AuthError(DomainError):
    """登录 / 换口令 / 注销的凭证校验失败 → 401 invalid_credentials（防枚举，不区分用户是否存在）。"""

    status = 401
    code = "invalid_credentials"


class UnauthorizedError(DomainError):
    """无 token / 验签失败 / 用户已注销（token 即时失效）→ 401 unauthorized。"""

    status = 401
    code = "unauthorized"


class RegistrationClosedError(DomainError):
    """注册策略 closed，或 invite 模式下邀请码错误 → 403。"""

    status = 403
    code = "registration_closed"


class NotFoundError(DomainError):
    """同步文件不存在 → 404。"""

    status = 404
    code = "not_found"


class ConflictError(DomainError):
    """乐观锁冲突（base_hash 不符）→ 409 conflict；
    同步冲突副本由客户端处理（DESIGN.md §5.3）。"""

    status = 409
    code = "conflict"


class UsernameTakenError(ConflictError):
    """注册用户名已被占用 → 409 username_taken（接受此枚举面，由注册限速兜底）。"""

    status = 409
    code = "username_taken"


class PayloadTooLargeError(DomainError):
    """单文件超过 NOTE_MD_FILE_MAX → 413。"""

    status = 413
    code = "payload_too_large"


class RateLimitError(DomainError):
    """注册/登录限速 → 429 rate_limited（Retry-After 头取 retry_after）。"""

    status = 429
    code = "rate_limited"

    def __init__(self, retry_after: int | None = None):
        super().__init__("rate limited")
        self.retry_after = retry_after

    def details(self) -> dict | None:
        return None if self.retry_after is None else {"retry_after": self.retry_after}


class RelayQuotaExceededError(DomainError):
    """中继当日配额用尽 → 429 relay_quota_exceeded，details.reset_at = 次日零点（Unix 秒）。"""

    status = 429
    code = "relay_quota_exceeded"

    def __init__(self, reset_at: int):
        super().__init__("relay daily quota exceeded")
        self.reset_at = reset_at

    def details(self) -> dict | None:
        return {"reset_at": self.reset_at}


class QuotaExceededError(DomainError):
    """用户存储配额用尽 → 507 storage_quota_exceeded。"""

    status = 507
    code = "storage_quota_exceeded"


class GatewayUnavailableError(DomainError):
    """LLM 网关未配置（OPENAI_BASE_URL/KEY 缺失）→ 503 upstream_unavailable。
    上游自身返回的错误不走本类——由 ports.UpstreamError 原样透传（API.md §5）。"""

    status = 503
    code = "upstream_unavailable"
