"""配置：全部来自环境变量（真实值只在 .env，不入库；默认值见 docs/API.md §7）。

环境变量（全部有代码默认值，仅需覆盖时设置）：
- NOTE_MD_REGISTRATION         注册策略 open（默认）/ invite / closed
- NOTE_MD_INVITE_CODE          invite 模式下的邀请码（可选）
- NOTE_MD_AUTH_RATE            注册/登录限速，次/分/IP（默认 10）
- NOTE_MD_FILE_MAX             单文件密文上限（默认 1 MiB）
- NOTE_MD_STORAGE_QUOTA        每用户存储配额（默认 1 GiB）
- NOTE_MD_RELAY_DAILY_QUOTA    中继日配额（默认 200 次/天/用户）
- NOTE_MD_TOKEN_TTL            token 有效期（默认 72h，支持 s/m/h/d）
- NOTE_MD_TOKEN_SECRET         token 签名密钥（可选；缺省时在数据目录生成并持久化）
- NOTE_MD_ROOT / NOTE_MD_DATA_DIR   /notes 密文仓库（<uid>/ 分片）/ 用户表目录
- OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL   LLM 网关（仅中继使用，不下发）

★ 没有 NOTE_MD_USERNAME / NOTE_MD_PASSWORD：口令只在客户端派生（DESIGN.md §6.3），
  服务端只存登录凭证哈希，由 /api/auth/register 写入 /data。
  ★ 没有任何「管理员凭证」：运营操作直接在服务器文件系统进行，不为管理后台开接口。

★ 本模块只做「读环境 → 出值」，不做业务；非法值在启动即抛（fail fast），
  避免带着错误配置静默运行。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

# 注册策略合法值（API.md §3）
REGISTRATION_MODES = ("open", "invite", "closed")

_TIME_UNITS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} 必须是整数，得到 {raw!r}") from exc
    if value <= 0:
        raise ValueError(f"{name} 必须为正数，得到 {value}")
    return value


def _duration_env(name: str, default: str) -> float:
    """解析时长：纯数字按秒，或 <数字><s|m|h|d>（如 72h）。"""
    raw = os.environ.get(name, "").strip() or default
    unit = raw[-1].lower()
    if unit in _TIME_UNITS:
        number = raw[:-1]
        try:
            seconds = float(number) * _TIME_UNITS[unit]
        except ValueError as exc:
            raise ValueError(f"{name} 时长格式非法：{raw!r}") from exc
    else:
        try:
            seconds = float(raw)
        except ValueError as exc:
            raise ValueError(f"{name} 时长格式非法：{raw!r}") from exc
    if seconds <= 0:
        raise ValueError(f"{name} 必须为正时长，得到 {raw!r}")
    return seconds


def _registration_env(name: str, default: str) -> str:
    raw = (os.environ.get(name, "").strip() or default).lower()
    if raw not in REGISTRATION_MODES:
        raise ValueError(f"{name} 必须是 {'/'.join(REGISTRATION_MODES)}，得到 {raw!r}")
    return raw


@dataclass(frozen=True)
class Settings:
    """不可变配置快照；core/adapters 构造时注入，运行期不重读环境。"""

    # 注册与限速（API.md §7）
    registration: str = "open"
    invite_code: str = ""
    auth_rate: int = 10  # 注册/登录 次/分/IP（登录另按 username 限速，见 core/auth）

    # 配额
    file_max: int = 1 << 20  # 单文件密文上限（字节）
    storage_quota: int = 1 << 30  # 每用户存储配额（字节）
    relay_daily_quota: int = 200  # 中继日配额（次/天/用户）

    # 认证
    token_ttl: float = 72 * 3600  # 秒
    token_secret: str = ""  # HMAC-SHA256 密钥；空则由组装根生成/读取持久化文件

    # 目录
    notes_root: Path = Path("/notes")  # 密文仓库：<notes_root>/<uid>/
    data_dir: Path = Path("/data")  # 用户表：<data_dir>/users/

    # LLM 网关（仅服务端中继内部使用，永不下发客户端）
    openai_base_url: str = ""
    openai_api_key: str = ""
    openai_model: str = ""

    @property
    def users_dir(self) -> Path:
        return self.data_dir / "users"


def load_settings() -> Settings:
    """从环境变量构建 Settings；非法值抛 ValueError（启动即失败）。"""
    return Settings(
        registration=_registration_env("NOTE_MD_REGISTRATION", "open"),
        invite_code=os.environ.get("NOTE_MD_INVITE_CODE", "").strip(),
        auth_rate=_int_env("NOTE_MD_AUTH_RATE", 10),
        file_max=_int_env("NOTE_MD_FILE_MAX", 1 << 20),
        storage_quota=_int_env("NOTE_MD_STORAGE_QUOTA", 1 << 30),
        relay_daily_quota=_int_env("NOTE_MD_RELAY_DAILY_QUOTA", 200),
        token_ttl=_duration_env("NOTE_MD_TOKEN_TTL", "72h"),
        token_secret=os.environ.get("NOTE_MD_TOKEN_SECRET", "").strip(),
        notes_root=Path(os.environ.get("NOTE_MD_ROOT", "/notes")),
        data_dir=Path(os.environ.get("NOTE_MD_DATA_DIR", "/data")),
        openai_base_url=os.environ.get("OPENAI_BASE_URL", "").strip().rstrip("/"),
        openai_api_key=os.environ.get("OPENAI_API_KEY", "").strip(),
        openai_model=os.environ.get("OPENAI_MODEL", "").strip(),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """进程内单例（组装根取用）；测试可直接构造 Settings 并 dependency_overrides。"""
    return load_settings()
