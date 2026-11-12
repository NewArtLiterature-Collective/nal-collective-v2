# nal-api/routes/account.py
# ============================================================================
# 用户自助注销账号（2026-11）
#
# 规则（主编确认）：
#   · 立即永久删除，不设反悔期
#   · 参赛作品一并删除：作品记录、参赛配图、报名信息（已入展的作品也从展厅消失）
#   · 未使用的付费权益（Pro 会员、加油包额度等）一并作废，不予退款；
#     符合 Pro 3 天退款条件的，应先发邮件申请退款再注销（前端确认页有提示）
#   · 支付记录由 Stripe 按财务法规保留，本平台无法删除
#
# 安全：须登录（JWT）+ 再次输入密码 + 输入"注销"二字确认；管理员账号不能自助注销。
# 删除顺序：先删存储里的图片和业务表记录，最后删账号本身（任何一步失败都不删账号，可重试）。
# ============================================================================

import asyncio
from fastapi import APIRouter, Header, HTTPException, Request
from supabase import create_client

from core.config import settings
from services.user_service import supabase_admin
from services import storage_service as storage     # 文件在 Cloudflare R2

router = APIRouter()

CONFIRM_TEXT = "注销"


def _fail(status: int, message: str):
    raise HTTPException(status_code=status, detail=message)


def _verify_password(email: str, password: str) -> bool:
    """用匿名客户端尝试以邮箱 + 密码登录，验证是本人操作；验证完立即退出该临时会话。"""
    try:
        anon = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
        res = anon.auth.sign_in_with_password({"email": email, "password": password})
        ok = bool(res and res.user)
        try:
            anon.auth.sign_out()
        except Exception:
            pass
        return ok
    except Exception:
        return False


def _delete_user_data(uid: str) -> dict:
    """删除该用户的全部业务数据与文件。返回统计；出错抛异常（此时账号尚未删除，可重试）。"""
    # 1) 参赛作品与配图
    subs = supabase_admin.table("contest_submissions").select("id, image_urls").eq("user_id", uid).execute().data or []
    contest_files = [u for s in subs for u in (s.get("image_urls") or [])]
    storage.delete_contest_images(contest_files)
    supabase_admin.table("contest_submissions").delete().eq("user_id", uid).execute()

    # 2) 报名信息（姓名、电话、监护人等）
    supabase_admin.table("contest_registrations").delete().eq("user_id", uid).execute()

    # 3) 日常评审上传的图片
    eval_files = 0
    try:
        eval_files = storage.delete_eval_uploads(uid)
    except Exception as e:
        print(f"⚠️ 注销：评审图片清理失败（不阻断）: {e}")

    # 4) 旧版 profiles 表（如存在）
    try:
        supabase_admin.table("profiles").delete().eq("id", uid).execute()
    except Exception:
        pass

    # contest_blocks 等外键为 on delete cascade 的记录，会随账号删除自动清除
    return {"submissions": len(subs), "contest_files": len(contest_files), "eval_files": eval_files}


@router.post("/delete")
async def delete_my_account(request: Request, authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        _fail(401, "登录已失效，请重新登录。")
    try:
        res = supabase_admin.auth.get_user(authorization.split(" ", 1)[1])
        user = res.user if res else None
        if not user:
            raise ValueError("no user")
    except Exception:
        _fail(401, "登录已失效，请重新登录。")

    try:
        body = await request.json()
    except Exception:
        body = {}
    password = (body.get("password") or "")
    confirm = (body.get("confirm_text") or "").strip()

    if (user.app_metadata or {}).get("role") == "admin":
        _fail(403, "管理员账号不能自助注销。")
    if confirm != CONFIRM_TEXT:
        _fail(422, f"请输入“{CONFIRM_TEXT}”二字确认。")
    if not password:
        _fail(422, "请输入登录密码。")
    if not user.email or not await asyncio.to_thread(_verify_password, user.email, password):
        _fail(403, "密码不正确。")

    uid = user.id
    try:
        stats = await asyncio.to_thread(_delete_user_data, uid)
    except Exception as e:
        print(f"🚨 注销：清理数据失败 user={uid}: {e}")
        _fail(500, "注销未完成：清理数据时出错，账号仍保留，请稍后重试或联系 info@nal-ai.org。")

    try:
        await asyncio.to_thread(supabase_admin.auth.admin.delete_user, uid)
    except Exception as e:
        print(f"🚨 注销：删除账号失败 user={uid}: {e}")
        _fail(500, "注销未完成：删除账号时出错，请稍后重试或联系 info@nal-ai.org。")

    print(f"🗑️ 用户自助注销完成 user={uid} {stats}")
    return {"status": "success"}
