"""NoteStore 实现：/notes 下按 <subject>/ 命名空间维护同步副本（只存密文）。

服务端视角下笔记本就是密文 blob 仓库：路径防护 / CRUD / 乐观锁语义照旧，
但 content 与 path 均为客户端加密后的传输字节，hash = 密文的 sha256——
永远不做任何明文语义处理（DESIGN.md §6.4）。

TODO: 实现 ports.NoteStore；路径防穿越（密文路径同样不可穿越）；hash 比对（冲突返回 409 语义）。
"""


# TODO: class FileNoteStore:
#     def __init__(self, root: str): ...
