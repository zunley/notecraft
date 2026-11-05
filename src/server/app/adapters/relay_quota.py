"""RelayQuota 实现：内存日计数（API.md §7）。

按 uid 计数、次日零点（本地时区）重置；重启清零——自托管场景可接受，
需要精确计费/审计时换持久化实现（只动本文件与 main.py 注入）。
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Callable


class MemRelayQuota:
    def __init__(self, daily_limit: int, clock: Callable[[], float] = time.time):
        self.daily_limit = daily_limit
        self._clock = clock
        self._counts: dict[str, tuple[date, int]] = {}

    @staticmethod
    def _day(ts: float) -> date:
        return datetime.fromtimestamp(ts).date()

    @staticmethod
    def _next_midnight(ts: float) -> int:
        now = datetime.fromtimestamp(ts)
        return int((datetime(now.year, now.month, now.day) + timedelta(days=1)).timestamp())

    def take(self, subject: str) -> bool:
        """尝试消耗 1 次当日额度；成功 True，超限 False（每次中继请求计 1，无论上游成败）。"""
        ts = self._clock()
        today = self._day(ts)
        day, used = self._counts.get(subject, (today, 0))
        if day != today:  # 跨天自动清零
            day, used = today, 0
        if used >= self.daily_limit:
            self._counts[subject] = (day, used)
            return False
        self._counts[subject] = (day, used + 1)
        return True

    def reset_at(self, subject: str) -> int:
        """当日配额重置时间（次日零点 Unix 秒），供 429 details.reset_at 使用。"""
        return self._next_midnight(self._clock())
