"""同步路由（API.md §4）——HTTP 薄壳：解析 → 调 core → 响应。

全部需认证；命名空间 = token sub（uid）；服务端只见密文（path/content 均为信封）。
校验与乐观锁语义在 core/sync 与 NoteStore，本文件只做参数绑定。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response

from ..core.sync import SyncCore
from ..types import User
from .deps import require_user
from .schemas import FilePutRequest, FilePutResponse, FileResponse, ManifestResponse

sync_router = APIRouter(prefix="/api/sync", tags=["sync"])


def _core(request: Request) -> SyncCore:
    return request.app.state.sync


@sync_router.get("/manifest", response_model=ManifestResponse)
def manifest(request: Request, user: User = Depends(require_user)) -> dict:
    return _core(request).manifest(user.uid)


@sync_router.get("/file", response_model=FileResponse)
def get_file(
    request: Request,
    path: str = Query(..., description="base64url(路径密文)"),
    user: User = Depends(require_user),
) -> dict:
    return _core(request).get(user.uid, path)


@sync_router.put("/file", response_model=FilePutResponse)
def put_file(
    body: FilePutRequest,
    request: Request,
    user: User = Depends(require_user),
) -> dict:
    return _core(request).put(user.uid, body.path, body.content, body.base_hash)


@sync_router.delete("/file", status_code=204)
def delete_file(
    request: Request,
    path: str = Query(...),
    base_hash: str = Query(...),
    user: User = Depends(require_user),
) -> Response:
    _core(request).delete(user.uid, path, base_hash)
    return Response(status_code=204)
