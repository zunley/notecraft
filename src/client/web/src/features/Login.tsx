/**
 * 登录页：username + password → 登录即解锁（DESIGN.md §6.3）。
 *
 * 用户只输入一次口令：客户端本地派生登录凭证（L）与加密密钥（KEK），
 * 登录请求携带 L，响应带回 protected_key，KEK 解出 MK——加密对用户无感。
 * 无账号可注册（策略见 GET /api/auth/policy）；注册即登录（POST /api/auth/register），
 * 客户端本地生成 MK 后上传信封，一次完成。
 *
 * TODO: token 过期不影响本地编辑与 AI 工具，仅中继与同步需重新登录（§3.6）。
 */
export function Login() {
  return <div>登录（骨架）</div>;
}
