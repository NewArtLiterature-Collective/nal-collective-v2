# nal-api/routes/contest.py
# ============================================================================
# 参赛投稿接口（2026-11）
#
# 投稿不再由前端直接写数据库，统一经本接口：
#   1. 身份与资格：登录用户；Pro（未过期）或已付本届报名费；已完成本届报名登记
#   2. 赛事状态：存在当前赛事、投稿大闸开启、未过截稿时间
#   3. 唯一性：本届已有有效作品、或已被取消资格（contest_blocks）→ 拒绝
#   4. 格式：标题 / 署名 / 正文 800–1000 字（不计空白）/ 配图正好 1 幅、JPG 或 PNG、≤10MB
#   5. 平台级拦截：文字与配图各送模型一次；被平台在输入阶段拦截（PROHIBITED_CONTENT 等，
#      关不掉的强制过滤）→ 不入库、记录拦截、本届取消参赛资格
#      · 只认平台拦截，不在这里做本平台口径的模型判断（误判风险高，且拦截即取消资格）；
#        本平台口径的完整内容安全检查仍由截稿后的批量评审（contest_agent.screen_work）完成
#      · 检查本身出错 / 超时 → 照常收稿，批量评审时会再查
#   6. 通过：上传配图到 R2 私有桶 contest_works/（数据库只存对象名）→ 写入 contest_submissions（status=pending）
# ============================================================================

import io
import re
import asyncio
from datetime import datetime, timezone
from typing import Optional

import PIL.Image
from fastapi import APIRouter, Header, Form, File, UploadFile, HTTPException

from services.user_service import supabase_admin
from services import content_review as cr
from services.contest_literary_service import _generate, SCREEN_MODEL
from services import storage_service as storage     # 参赛配图存 Cloudflare R2 私有桶

router = APIRouter()

MIN_CHARS, MAX_CHARS = 800, 1000
MAX_TITLE, MAX_NAME = 50, 40
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_JPEG_PIXELS = 50_000_000
MAX_PNG_PIXELS = 25_000_000
SCREEN_DIM = 1024                 # 送平台检查的配图缩到 1024px，够判断、省内存
SCREEN_TIMEOUT = 60               # 平台检查超时（秒）：超时按"检查出错"处理，照常收稿

_SCREEN_SEM = asyncio.Semaphore(3)            # 同时进行的投稿检查数（控制内存与模型并发）
_user_locks: dict[str, asyncio.Lock] = {}     # 同一用户的投稿串行处理，防止连点重复入库

_SCREEN_SYS = '你是投稿接收确认程序。收到内容后只回复 JSON：{"received": true}。不评价、不复述内容。'


def _fail(status: int, message: str, code: str = "invalid"):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def _get_user(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        _fail(401, "缺少身份验证，请重新登录。", "auth")
    try:
        res = supabase_admin.auth.get_user(authorization.split(" ", 1)[1])
        if not res or not res.user:
            raise ValueError("no user")
        return res.user
    except HTTPException:
        raise
    except Exception:
        _fail(401, "登录已失效，请重新登录。", "auth")


def _is_eligible(app_meta: dict, contest_id: str) -> bool:
    """与前端 Dashboard 的判定一致：未过期的 Pro，或已付本届报名费的参赛者。"""
    role = app_meta.get("role")
    if role == "pro":
        exp = app_meta.get("expiry_date")
        if not exp:
            return True
        try:
            return datetime.now(timezone.utc) <= datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
        except Exception:
            return False
    return role == "contestant" and app_meta.get("paid_contest_id") == contest_id


def _prepare_image(raw: bytes) -> tuple:
    """校验配图并生成送检用的缩小图。返回 (mime, ext, screen_image)。不合格直接抛 422。"""
    try:
        img = PIL.Image.open(io.BytesIO(raw))      # 只读文件头，未解码像素
    except Exception:
        _fail(422, "配图无法读取，请确认是完整的 JPG 或 PNG 文件。")
    fmt = img.format
    if fmt not in ("JPEG", "MPO", "PNG"):
        _fail(422, f"配图格式不支持（{fmt or '未知'}），仅接受 JPG 或 PNG。")
    w, h = img.size
    if fmt == "PNG" and w * h > MAX_PNG_PIXELS:
        _fail(422, f"PNG 配图尺寸过大（{w}×{h}），请压缩到约 5000×5000 以内，或另存为 JPG。")
    if w * h > MAX_JPEG_PIXELS:
        _fail(422, f"配图尺寸过大（{w}×{h}），请压缩到约 7000×7000 以内。")
    try:
        try:
            img.draft("RGB", (SCREEN_DIM, SCREEN_DIM))   # JPEG 缩尺解码，PNG 自动忽略
        except Exception:
            pass
        img = img.convert("RGB")
        img.thumbnail((SCREEN_DIM, SCREEN_DIM), PIL.Image.Resampling.LANCZOS)
    except Exception:
        _fail(422, "配图解码失败，文件可能已损坏，请重新导出后上传。")
    if fmt == "PNG":
        return "image/png", "png", img
    return "image/jpeg", "jpg", img


async def _platform_check(contents) -> str:
    """送模型一次。返回 'blocked'（平台拦截）/ 'ok' / 'error'（调用失败，不定性）。"""
    try:
        res = await _generate(SCREEN_MODEL, contents, _SCREEN_SYS,
                              safety_settings=cr.moderation_safety_settings())
        if cr.platform_blocked(res):
            print(f"🚫 投稿平台级拦截: {cr.diag(res)}")
            return "blocked"
        return "ok"
    except Exception as e:
        print(f"⚠️ 投稿平台检查异常（照常收稿）: {e}")
        return "error"


async def _screen(text: str, screen_img) -> dict:
    """文字、配图分开各送一次（能说清是哪一部分被拦），并发进行。"""
    async with _SCREEN_SEM:
        try:
            t, i = await asyncio.wait_for(asyncio.gather(
                _platform_check([text]),
                _platform_check(["参赛配图：", screen_img]),
            ), timeout=SCREEN_TIMEOUT)
        except asyncio.TimeoutError:
            print("⚠️ 投稿平台检查超时（照常收稿）")
            return {"blocked": [], "error": True}
    blocked = [w for w, r in (("text", t), ("image", i)) if r == "blocked"]
    return {"blocked": blocked, "error": "error" in (t, i)}


@router.post("/submit")
async def submit_contest_work(
    authorization: str = Header(None),
    title: str = Form(""),
    author_name: str = Form(""),
    illustrator_name: str = Form(""),
    text_content: str = Form(""),
    ai_declaration: str = Form(""),
    image: UploadFile = File(None),
):
    user = _get_user(authorization)
    uid = user.id
    lock = _user_locks.setdefault(uid, asyncio.Lock())
    if lock.locked():
        _fail(429, "您的作品正在提交中，请勿重复点击。", "busy")

    async with lock:
        # ---- 1. 当前赛事与投稿大闸 ----
        st = supabase_admin.table("site_settings").select("current_contest_id, is_contest_active") \
            .eq("id", 1).maybe_single().execute()
        settings = (st.data if st else None) or {}
        contest_id = settings.get("current_contest_id")
        if not contest_id or not settings.get("is_contest_active"):
            _fail(403, "当前没有开放投稿的赛事。", "closed")
        ct = supabase_admin.table("contests").select("submission_deadline") \
            .eq("id", contest_id).maybe_single().execute()
        deadline = ((ct.data if ct else None) or {}).get("submission_deadline")
        if deadline:
            try:
                if datetime.now(timezone.utc) > datetime.fromisoformat(str(deadline).replace("Z", "+00:00")):
                    _fail(403, "本届投稿已截止。", "closed")
            except HTTPException:
                raise
            except Exception:
                pass

        # ---- 2. 资格与报名登记 ----
        if not _is_eligible(user.app_metadata or {}, contest_id):
            _fail(403, "您尚未获得本届参赛资格，请先完成报名缴费。", "not_eligible")
        reg = supabase_admin.table("contest_registrations").select("user_id") \
            .eq("user_id", uid).eq("contest_id", contest_id).limit(1).execute()
        if not reg.data:
            _fail(403, "请先填写本届报名信息并确认参赛规则。", "not_registered")

        # ---- 3. 唯一性：已取消资格 / 已有有效作品 ----
        blk = supabase_admin.table("contest_blocks").select("id") \
            .eq("user_id", uid).eq("contest_id", contest_id).limit(1).execute()
        if blk.data:
            _fail(403, "您的本届参赛资格已因内容违规被取消，不能再提交作品。", "content_blocked")
        subs = supabase_admin.table("contest_submissions").select("id, status") \
            .eq("user_id", uid).eq("contest_id", contest_id).execute()
        if any(s.get("status") != "invalid" for s in (subs.data or [])):
            _fail(409, "您已经提交过本届参赛作品，每个账号限投一件。", "duplicate")

        # ---- 4. 格式校验 ----
        title, author_name, illustrator_name = title.strip(), author_name.strip(), (illustrator_name or "").strip()
        if not title or len(title) > MAX_TITLE:
            _fail(422, f"请填写作品标题（{MAX_TITLE} 字以内）。")
        if not author_name or len(author_name) > MAX_NAME:
            _fail(422, f"请填写文字作者署名（{MAX_NAME} 字以内）。")
        if len(illustrator_name) > MAX_NAME:
            _fail(422, f"插画作者署名请控制在 {MAX_NAME} 字以内。")
        if ai_declaration not in ("yes", "no"):
            _fail(422, "请先完成 AI 辅助创作声明。")
        n = len(re.sub(r"\s", "", text_content or ""))
        if not (MIN_CHARS <= n <= MAX_CHARS):
            _fail(422, f"参赛正文须为 {MIN_CHARS}–{MAX_CHARS} 字（不计空格与换行），当前 {n} 字。")

        if image is None:
            _fail(422, "请上传 1 幅配图。")
        raw = await image.read(MAX_IMAGE_BYTES + 1)
        if len(raw) > MAX_IMAGE_BYTES:
            _fail(422, "配图不得超过 10MB。")
        if not raw:
            _fail(422, "请上传 1 幅配图。")
        mime, ext, screen_img = await asyncio.to_thread(_prepare_image, raw)

        # ---- 5. 平台级拦截 ----
        result = await _screen(text_content, screen_img)
        screen_img = None
        if result["blocked"]:
            where = "、".join({"text": "文字", "image": "配图"}[w] for w in result["blocked"])
            try:
                supabase_admin.table("contest_blocks").upsert({
                    "user_id": uid,
                    "contest_id": contest_id,
                    "block_where": ",".join(result["blocked"]),
                    "detail": f"{where}被平台内容审核拦截；标题：{title[:50]}",
                }, on_conflict="user_id,contest_id").execute()
            except Exception as e:
                print(f"🚨 拦截记录写入失败（仍按拦截处理）: {e}")
            _fail(422, (f"您提交的{where}未能通过平台的内容审核。依据参赛规则，本届参赛资格已取消，"
                        f"不能再提交作品。如您认为这是误判，请发邮件至 info@nal-ai.org 说明情况。"),
                  "content_blocked")

        # ---- 6. 入库：先存配图，再写作品记录 ----
        object_name = f"{uid}_{int(datetime.now(timezone.utc).timestamp() * 1000)}.{ext}"
        try:
            await asyncio.to_thread(storage.put_contest_image, object_name, raw, mime)
        except Exception as e:
            print(f"🚨 参赛配图上传失败: {e}")
            _fail(500, "配图保存失败，请稍后重试。", "storage")
        raw = None
        try:
            ins = supabase_admin.table("contest_submissions").insert({
                "user_id": uid,
                "user_email": user.email,
                "contest_id": contest_id,
                "title": title,
                "author_name": author_name,
                "illustrator_name": illustrator_name or None,
                "text_content": text_content,
                "image_urls": [object_name],
                "status": "pending",
                "has_declared_ai": ai_declaration == "yes",
            }).execute()
        except Exception as e:
            print(f"🚨 参赛作品写入失败: {e}")
            try:
                storage.delete_contest_images([object_name])
            except Exception:
                pass
            _fail(500, "作品保存失败，请稍后重试。", "db")

        if result["error"]:
            print(f"⏳ 作品已收稿，但平台检查未完成，批量评审时复查: user={uid}")
        sid = (ins.data or [{}])[0].get("id")
        return {"status": "success", "submission_id": sid}
