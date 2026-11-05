"""UserStore 实现：/data 卷上的用户表（零知识，API.md §8）。

每用户一个 JSON 文件 /data/users/<uid>.json：
{uid, username, login_verifier(=hash(L)), protected_key, created_at}

- uid 注册时生成（随机 16 字节 hex），永不改变——token sub 与 /notes/<uid>/ 都用它；
- username 小写唯一索引，仅作登录句柄，不进任何路径；
- 服务端从未见过口令/KEK/MK——拖库只能拿到 hash(L) 与打不开的信封。

远期替换：SQLite/Postgres（用户数 ~10³），只换本文件与 main.py 注入。
"""


# TODO: class FileUserStore:
#     def __init__(self, data_dir: str): ...
#     def create(self, username: str, password: str, protected_key: str) -> User: ...
#     def verify(self, username: str, password: str) -> tuple[str, str] | None: ...
#     def get(self, uid: str) -> User | None: ...
#     def put_key(self, uid: str, password: str, protected_key: str) -> None: ...
#     def delete(self, uid: str) -> None: ...
