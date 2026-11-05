"""RelayQuota 实现：内存日计数（API.md §7）。

按 uid 计数、次日零点（本地时区）重置；重启清零——自托管场景可接受，
需要精确计费/审计时换持久化实现（只动本文件与 main.py 注入）。
"""


# TODO: class MemRelayQuota:
#     def __init__(self, daily_limit: int): ...
#     def take(self, subject: str) -> bool: ...
#     def reset_at(self, subject: str) -> int: ...
