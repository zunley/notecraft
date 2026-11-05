"""SessionArchive 实现：追加写 DATA_DIR/sessions/（独立挂载卷）。

★ 无任何对外读取 API（D6）；备份策略与 /notes 分开
  （workflow/backup.sh 需相应加一条）。

远期替换：客户端加密上传，或中继退役后仅客户端留存（DESIGN-V2 §7）。
"""


# TODO: class FsSessionArchive:
#     def __init__(self, data_dir: str): ...
#     def append(self, subject: str, conversation_id: str, record: dict) -> None: ...
