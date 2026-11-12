# nal-api/routes/media.py
# ============================================================================
# 文件上传 / 签名接口（Cloudflare R2，2026-11）
# 浏览器不持有 R2 密钥，所有写入都经后端；私有文件的读取由后端签发限时链接。
#   POST /api/v1/media/eval-upload          登录用户：日常评审上传一张图片 → 返回限时链接（交给评审接口）
#   POST /api/v1/media/admin/sign-contest   管理员：为参赛配图签发限时链接（管理后台查看作品）
#   POST /api/v1/media/showcase/upload      管理员：上传一张展厅图片（已在浏览器压缩并加水印）
#   POST /api/v1/media/showcase/delete      管理员：删除展厅图片
#   GET  /api/v1/media/showcase/raw         管理员：取回展厅图片原始字节（补加水印用）
# ============================================================================

import re
import time
import uuid
import asyncio
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import Response

from services.user_service import supabase_admin
from services import storage_service as storage

router = APIRouter()

EVAL_MAX_BYTES = 15 * 1024 * 1024        # 与视觉评审的单张下载上限一致
EVAL_URL_TTL = 2 * 3600                  # 评审排队 + Pro 二次读图，留足 2 小时
SHOWCASE_MAX_BYTES = 5 * 1024 * 1024     # 展厅图片已在浏览器压缩到长边 2400px
CONTEST_URL_TTL = 3600
_SHOWCASE_PATH = re.compile(r"^[0-9a-fA-F-]{36}/[\w.\-]{1,80}\.(jpg|jpeg|png)$")
_IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png"}


def _user(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录。")
    try:
        res = supabase_admin.auth.get_user(authorization.split(" ", 1)[1])
        if not res or not res.user:
            raise ValueError
        return res.user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录。")


def _admin(authorization: Optional[str]):
    u = _user(authorization)
    if (u.app_metadata or {}).get("role") != "admin":
        raise HTTPException(status_code=403, detail="无管理员权限")
    return u


def _sniff_image(data: bytes) -> Optional[str]:
    """按文件头判断格式，不信任浏览器给的类型。"""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return None


async def _read_limited(f: UploadFile, limit: int) -> bytes:
    data = await f.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"图片不得超过 {limit // (1024 * 1024)}MB。")
    if not data:
        raise HTTPException(status_code=422, detail="文件为空。")
    return data


@router.post("/eval-upload")
async def eval_upload(authorization: str = Header(None), file: UploadFile = File(...)):
    user = _user(authorization)
    data = await _read_limited(file, EVAL_MAX_BYTES)
    ctype = _sniff_image(data)
    if not ctype:
        raise HTTPException(status_code=422, detail="仅支持 JPG / PNG 图片。")
    name = f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}.{_IMAGE_TYPES[ctype]}"
    try:
        key = await asyncio.to_thread(storage.put_eval_upload, user.id, name, data, ctype)
        url = await asyncio.to_thread(storage.signed_get_url, storage.private_bucket(), key, EVAL_URL_TTL)
    except Exception as e:
        print(f"🚨 评审图片上传失败: {e}")
        raise HTTPException(status_code=500, detail="图片上传失败，请稍后重试。")
    return {"url": url}


@router.post("/admin/sign-contest")
async def admin_sign_contest(request: Request, authorization: str = Header(None)):
    _admin(authorization)
    body = await request.json()
    names = [n for n in (body.get("names") or []) if isinstance(n, str)][:500]
    out = {}
    for n in names:
        try:
            out[n] = storage.sign_contest_image(n, CONTEST_URL_TTL)
        except Exception as e:
            print(f"⚠️ 签名失败 [{n}]: {e}")
    return {"data": out}


@router.post("/showcase/upload")
async def showcase_upload(authorization: str = Header(None), path: str = Form(...), file: UploadFile = File(...)):
    _admin(authorization)
    if not _SHOWCASE_PATH.match(path or ""):
        raise HTTPException(status_code=422, detail="图片路径不合法。")
    data = await _read_limited(file, SHOWCASE_MAX_BYTES)
    ctype = _sniff_image(data)
    if not ctype:
        raise HTTPException(status_code=422, detail="仅支持 JPG / PNG 图片。")
    try:
        await asyncio.to_thread(storage.put_showcase, path, data, ctype)
    except Exception as e:
        print(f"🚨 展厅图片上传失败: {e}")
        raise HTTPException(status_code=500, detail="图片上传失败，请稍后重试。")
    return {"status": "success", "path": path}


@router.post("/showcase/delete")
async def showcase_delete(request: Request, authorization: str = Header(None)):
    _admin(authorization)
    body = await request.json()
    paths = [p for p in (body.get("paths") or []) if isinstance(p, str) and _SHOWCASE_PATH.match(p)]
    if paths:
        try:
            await asyncio.to_thread(storage.delete_showcase, paths)
        except Exception as e:
            print(f"🚨 展厅图片删除失败: {e}")
            raise HTTPException(status_code=500, detail="图片删除失败，请稍后重试。")
    return {"status": "success", "deleted": len(paths)}


@router.get("/showcase/raw")
async def showcase_raw(path: str, authorization: str = Header(None)):
    _admin(authorization)
    if not _SHOWCASE_PATH.match(path or ""):
        raise HTTPException(status_code=422, detail="图片路径不合法。")
    try:
        data = await asyncio.to_thread(storage.get_showcase, path)
    except Exception:
        raise HTTPException(status_code=404, detail="图片不存在。")
    return Response(content=data, media_type="image/png" if path.lower().endswith(".png") else "image/jpeg",
                    headers={"Cache-Control": "no-store"})
