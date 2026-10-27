# routes/gallery.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone
from services.user_service import supabase_admin

router = APIRouter(prefix="/gallery", tags=["Exhibition"])

CONTEST_BUCKET = "contest_works"
SIGNED_URL_TTL = 3600  # 签名 URL 有效期（秒）


def _object_name_from(url_or_path: str) -> str:
    """从存储的值里取出对象名。兼容两种历史写法：
    - 完整公开 URL：.../object/public/contest_works/<name>
    - 直接是对象名：<name>
    """
    if not url_or_path:
        return ""
    marker = f"/{CONTEST_BUCKET}/"
    if marker in url_or_path:
        return url_or_path.split(marker, 1)[1].split("?", 1)[0]
    return url_or_path.lstrip("/")


def _gallery_is_open() -> bool:
    """展厅时空大闸：is_gallery_active 为真，且（若设了时间窗）当前在窗内。"""
    try:
        s = supabase_admin.table("site_settings") \
            .select("is_gallery_active, current_contest_id").eq("id", 1).single().execute()
        if not s.data or not s.data.get("is_gallery_active"):
            return False
        cid = s.data.get("current_contest_id")
        if not cid:
            return True
        c = supabase_admin.table("contests") \
            .select("gallery_start_time, gallery_end_time").eq("id", cid).single().execute()
        if c.data:
            now = datetime.now(timezone.utc)
            st, en = c.data.get("gallery_start_time"), c.data.get("gallery_end_time")
            if st and now < datetime.fromisoformat(st.replace("Z", "+00:00")):
                return False
            if en and now > datetime.fromisoformat(en.replace("Z", "+00:00")):
                return False
        return True
    except Exception as e:
        print(f"⚠️ 展厅大闸校验异常: {e}")
        return False


class SignRequest(BaseModel):
    submission_ids: list[str]


@router.post("/images")
async def sign_winner_images(req: SignRequest):
    """
    为【已入展 + 展厅开启】的作品签发图片 signed URL（私有桶下展厅唯一取图途径）。
    安全：逐条校验 status='success' 且 (exhibition_ready 或 is_manual_recommended)，
    只会签发公开获奖作品的图；非入展/未开放一律不签，杜绝“任意对象签名”漏洞。
    """
    if not req.submission_ids:
        return {"data": {}}
    if not _gallery_is_open():
        return {"status": "closed", "data": {}}

    out: dict[str, list] = {}
    try:
        rows = supabase_admin.table("contest_submissions") \
            .select("id, image_urls, status, exhibition_ready, is_manual_recommended") \
            .in_("id", req.submission_ids) \
            .eq("status", "success") \
            .execute()
        for r in rows.data or []:
            if not (r.get("exhibition_ready") or r.get("is_manual_recommended")):
                continue  # 未入展的不签
            signed = []
            for item in (r.get("image_urls") or []):
                name = _object_name_from(item)
                if not name:
                    continue
                try:
                    res = supabase_admin.storage.from_(CONTEST_BUCKET) \
                        .create_signed_url(name, SIGNED_URL_TTL)
                    url = res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
                    if url:
                        signed.append(url)
                except Exception as e:
                    print(f"⚠️ 签名失败 [{name}]: {e}")
            out[r["id"]] = signed
    except Exception as e:
        print(f"🚨 展厅签名接口异常: {e}")
        raise HTTPException(status_code=500, detail="无法生成展厅图片，请稍后再试。")

    return {"status": "success", "data": out}


@router.get("/exhibition")
async def get_exhibition_works():
    """
    （可选）服务端策展接口：时空大闸 + 三类作品，并为每件附带签名图 URL。
    前端若改为完全由后端取数，可直连此接口；当前 Gallery 仍自查表 + 调 /images 签名。
    """
    if not _gallery_is_open():
        return {"status": "closed", "data": {"controversial": [], "ai_recommended": [], "manual_recommended": []}}

    def _attach_signed(rows):
        for r in rows or []:
            signed = []
            for item in (r.get("image_urls") or []):
                name = _object_name_from(item)
                if not name:
                    continue
                try:
                    res = supabase_admin.storage.from_(CONTEST_BUCKET).create_signed_url(name, SIGNED_URL_TTL)
                    url = res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
                    if url:
                        signed.append(url)
                except Exception:
                    pass
            r["signed_urls"] = signed
        return rows

    try:
        controversial = supabase_admin.table("contest_submissions").select("*") \
            .eq("status", "success").eq("exhibition_ready", True) \
            .order("ai_variance", desc=True).limit(5).execute()
        ai_recommended = supabase_admin.table("contest_submissions").select("*") \
            .eq("status", "success").eq("exhibition_ready", True) \
            .order("ai_total_score", desc=True).limit(5).execute()
        manual = supabase_admin.table("contest_submissions").select("*") \
            .eq("status", "success").eq("is_manual_recommended", True) \
            .order("manual_rank", desc=False).order("created_at", desc=True).limit(5).execute()
        return {
            "status": "success",
            "data": {
                "controversial": _attach_signed(controversial.data or []),
                "ai_recommended": _attach_signed(ai_recommended.data or []),
                "manual_recommended": _attach_signed(manual.data or []),
            }
        }
    except Exception as e:
        print(f"🚨 展厅数据获取失败: {e}")
        raise HTTPException(status_code=500, detail="无法获取展厅内容，请稍后再试。")
