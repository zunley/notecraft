"""NoteStore 实现：/notes 下按 <subject>/ 命名空间维护同步副本。

沿用 v1 filesvc 语义（路径防护 / CRUD / 乐观锁 / .trash/ 回收站），
仅服务同步——面向客户端编辑的文件 API 已在 v2 删除（DESIGN-V2 §4.1）。

TODO: 实现 ports.NoteStore；路径防穿越；hash 比对（冲突返回 409 语义）。
加密阶段：换为只存密文的实现（§5.6 CipherAdapter 的服务端对应物）。
"""


# TODO: class FileNoteStore:
#     def __init__(self, root: str): ...
