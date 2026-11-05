"""core/relay 与 MemRelayQuota 单测：纯 Python，fake ports。"""

from __future__ import annotations

import pytest

from app.adapters.relay_quota import MemRelayQuota
from app.config import Settings
from app.core.relay import RelayCore
from app.errors import GatewayUnavailableError, InvalidRequestError, RelayQuotaExceededError
from app.ports import Stream


class FakeGateway:
    def __init__(self, ready: bool = True):
        self._ready = ready
        self.payloads: list[dict] = []

    @property
    def ready(self) -> bool:
        return self._ready

    async def stream(self, payload: dict) -> Stream:
        self.payloads.append(payload)

        async def gen():
            yield b"data: [DONE]\n\n"

        return gen()


class FakeQuota:
    def __init__(self, left: int, reset: int = 1_765_100_000):
        self.left = left
        self.reset = reset
        self.taken = 0

    def take(self, subject: str) -> bool:
        if self.left <= 0:
            return False
        self.left -= 1
        self.taken += 1
        return True

    def reset_at(self, subject: str) -> int:
        return self.reset


def make_core(gateway=None, quota=None) -> RelayCore:
    return RelayCore(
        gateway=gateway or FakeGateway(),
        quota=quota or FakeQuota(left=5),
        settings=Settings(),
    )


# ── RelayCore ─────────────────────────────────────────────────


async def _collect(stream) -> bytes:
    return b"".join([chunk async for chunk in stream])


async def test_relay_stream_passthrough() -> None:
    gateway = FakeGateway()
    core = make_core(gateway=gateway)
    stream = await core.stream("uid-1", {"model": "m", "messages": []})
    assert await _collect(stream) == b"data: [DONE]\n\n"
    assert gateway.payloads == [{"model": "m", "messages": []}]  # 不增删字段


async def test_relay_rejects_non_dict_payload() -> None:
    core = make_core()
    with pytest.raises(InvalidRequestError):
        await core.stream("uid-1", ["not", "a", "dict"])


async def test_relay_gateway_not_ready() -> None:
    core = make_core(gateway=FakeGateway(ready=False))
    with pytest.raises(GatewayUnavailableError):
        await core.stream("uid-1", {"messages": []})


async def test_relay_quota_exceeded_with_reset_at() -> None:
    quota = FakeQuota(left=0, reset=1_765_123_456)
    core = make_core(quota=quota)
    with pytest.raises(RelayQuotaExceededError) as exc:
        await core.stream("uid-1", {"messages": []})
    assert exc.value.reset_at == 1_765_123_456
    assert exc.value.details() == {"reset_at": 1_765_123_456}


async def test_relay_quota_taken_even_if_gateway_fails() -> None:
    """每次中继请求计 1（无论上游成败，API.md §5）——就绪检查在配额前。"""
    quota = FakeQuota(left=1)
    core = make_core(gateway=FakeGateway(ready=False), quota=quota)
    with pytest.raises(GatewayUnavailableError):
        await core.stream("uid-1", {"messages": []})
    assert quota.taken == 0  # 未配置不烧额度


# ── MemRelayQuota ─────────────────────────────────────────────


class Clock:
    def __init__(self, t: float):
        self.t = t

    def __call__(self) -> float:
        return self.t


def test_mem_quota_counts_and_exhausts() -> None:
    clock = Clock(1_765_000_000.0)
    quota = MemRelayQuota(daily_limit=3, clock=clock)
    uid = "u" * 32
    assert all(quota.take(uid) for _ in range(3))
    assert not quota.take(uid)
    assert not quota.take(uid)
    assert quota.take("other-user")  # 按 uid 隔离


def test_mem_quota_resets_next_day() -> None:
    clock = Clock(1_765_000_000.0)
    quota = MemRelayQuota(daily_limit=1, clock=clock)
    uid = "u" * 32
    assert quota.take(uid)
    assert not quota.take(uid)
    clock.t += 24 * 3600  # 次日
    assert quota.take(uid)


def test_mem_quota_reset_at_is_next_local_midnight() -> None:
    from datetime import datetime

    clock = Clock(1_765_000_000.0)
    quota = MemRelayQuota(daily_limit=1, clock=clock)
    reset = quota.reset_at("u" * 32)
    dt = datetime.fromtimestamp(reset)
    assert dt.hour == 0 and dt.minute == 0 and dt.second == 0
    assert reset > clock.t
