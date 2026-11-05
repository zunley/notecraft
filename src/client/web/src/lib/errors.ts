/**
 * 领域错误单源（与服务端 app/errors.py 对称，ARCHITECTURE.md §3 / API.md §2）。
 *
 * ★ HTTP→领域错误的唯一翻译点是 lib/api.ts 调用的 translateHttpError：
 *   features / state 只 catch 领域错误，不接触 status code 与错误码字符串。
 * ★ storage 的乐观锁冲突（ConflictError）也定义在此——错误只有一个来源，
 *   storage/types.ts 只做再导出以保持 StorageAdapter 契约的就近可见。
 */

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 本地写入/同步的乐观锁冲突（base_hash 不符）——DESIGN.md §5.3 由客户端处理 */
export class ConflictError extends DomainError {
  constructor(public readonly path: string) {
    super("conflict", `conflict: ${path}`);
  }
}

/** 无网络 / 请求发不出去——本地功能不受影响（DESIGN.md §3.6） */
export class OfflineError extends DomainError {
  constructor(message = "offline") {
    super("offline", message);
  }
}

/** token 缺失、验签失败或过期——仅中继与同步需要重新登录 */
export class AuthExpiredError extends DomainError {
  constructor(message = "unauthorized") {
    super("auth_expired", message);
  }
}

/** 同步文件不存在（服务端 404） */
export class NotFoundError extends DomainError {
  constructor(message = "not found") {
    super("not_found", message);
  }
}

/** 参数/信封非法（服务端 400） */
export class InvalidRequestError extends DomainError {
  constructor(message = "invalid request") {
    super("invalid_request", message);
  }
}

/** 注册策略关闭 / 邀请码错误（服务端 403） */
export class RegistrationClosedError extends DomainError {
  constructor(message = "registration closed") {
    super("registration_closed", message);
  }
}

/** 注册/登录限速（服务端 429 rate_limited） */
export class RateLimitedError extends DomainError {
  constructor(message = "rate limited", public readonly retryAfter?: number) {
    super("rate_limited", message, retryAfter === undefined ? undefined : { retry_after: retryAfter });
  }
}

/** 中继当日配额用尽（服务端 429 relay_quota_exceeded） */
export class RelayQuotaError extends DomainError {
  constructor(message = "relay quota exceeded", public readonly resetAt?: number) {
    super("relay_quota_exceeded", message, resetAt === undefined ? undefined : { reset_at: resetAt });
  }
}

/** 单文件超限（服务端 413） */
export class PayloadTooLargeError extends DomainError {
  constructor(message = "payload too large") {
    super("payload_too_large", message);
  }
}

/** 存储配额用尽（服务端 507） */
export class StorageQuotaError extends DomainError {
  constructor(message = "storage quota exceeded") {
    super("storage_quota_exceeded", message);
  }
}

/** 其余服务端错误（5xx 等） */
export class ServerError extends DomainError {
  constructor(message = "server error") {
    super("server_error", message);
  }
}

/** 服务端统一错误形状（API.md §2） */
interface WireError {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

/**
 * HTTP → 领域错误的唯一翻译点。
 * @param status HTTP 状态码
 * @param body   响应体（已解析的 JSON；非 JSON 时传 undefined）
 */
export function translateHttpError(status: number, body: unknown): DomainError {
  const wire = (body ?? {}) as WireError;
  const code = wire.error?.code;
  const message = wire.error?.message ?? `http ${status}`;
  const details = wire.error?.details;

  switch (code) {
    case "invalid_credentials":
      return new InvalidRequestError(message); // 不区分用户是否存在（防枚举），语义仍是凭证错误
    case "unauthorized":
      return new AuthExpiredError(message);
    case "registration_closed":
      return new RegistrationClosedError(message);
    case "not_found":
      return new NotFoundError(message);
    case "conflict":
      return new DomainError("conflict", message, details);
    case "username_taken":
      return new DomainError("username_taken", message, details);
    case "invalid_request":
      return new InvalidRequestError(message);
    case "rate_limited":
      return new RateLimitedError(message, (details?.retry_after as number) ?? undefined);
    case "relay_quota_exceeded":
      return new RelayQuotaError(message, (details?.reset_at as number) ?? undefined);
    case "payload_too_large":
      return new PayloadTooLargeError(message);
    case "storage_quota_exceeded":
      return new StorageQuotaError(message);
    default:
      break;
  }

  // 无错误码（网关故障页等）时按状态码兜底
  if (status === 401) return new AuthExpiredError(message);
  if (status === 404) return new NotFoundError(message);
  if (status === 409) return new DomainError("conflict", message, details);
  if (status === 413) return new PayloadTooLargeError(message);
  if (status === 429) return new RateLimitedError(message);
  return new ServerError(message);
}
