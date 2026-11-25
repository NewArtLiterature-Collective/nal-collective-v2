# routes/admin.py
import asyncio
import threading
from fastapi import APIRouter, BackgroundTasks, HTTPException, Header
from pydantic import BaseModel
from services.user_service import supabase_admin
from services.contest_agent import run_batch_review, deadline_passed
from services.curator_script import auto_curate_top_percent

router = APIRouter(prefix="/admin", tags=["Admin Control"])

class TimeSettings(BaseModel):
    start_time: str
    end_time: str


# ==========================================================
# 鉴权：校验调用者的 Supabase JWT 且 app_metadata.role == 'admin'
#   —— 不再使用塞进浏览器的静态 ADMIN_SECRET_KEY（会随打包文件泄露）。
#   前端需在请求头带 Authorization: Bearer <access_token>。
# ==========================================================
def verify_admin(authorization: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少身份验证")
    token = authorization.split(" ", 1)[1]
    try:
        res = supabase_admin.auth.get_user(token)
        user = res.user if res else None
        if not user:
            raise Exception("会话无效")
    except Exception:
        raise HTTPException(status_code=401, detail="身份验证失败，请重新登录")

    # 🔒 role 存在 app_metadata（仅 service_role 可写），不是用户可改的 user_metadata
    role = (user.app_metadata or {}).get("role")
    if role != "admin":
        raise HTTPException(status_code=403, detail="无管理员权限")
    return user


# 1. 时空大闸
@router.post("/settings/gallery-time")
async def update_gallery_time(settings_data: TimeSettings, authorization: str = Header(None)):
    verify_admin(authorization)
    try:
        supabase_admin.table("site_settings").update({
            "gallery_start_time": settings_data.start_time,
            "gallery_end_time": settings_data.end_time
        }).eq("id", 1).execute()
        return {"status": "success", "msg": "展厅时空大闸已更新"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 2. 评审引擎
#    2026-11-25：同一时间只允许一轮评审；每轮开始前，把上一轮中断（部署 / 实例重启）留下的"评审中"作品退回待审。
#    Render 上是单实例，本进程没有在跑的批次时，"评审中"的作品一定是中断遗留的。
_review_lock = threading.Lock()


def run_contest_agent():
    if not _review_lock.acquire(blocking=False):
        print("⏭️ 已有一轮评审在进行，本次启动忽略。")
        return
    try:
        print("⚡ 接收到中控台指令，正在启动 AI 评审...")
        try:
            res = supabase_admin.table("contest_submissions") \
                .update({"status": "pending", "error_msg": None}) \
                .eq("status", "processing").execute()
            n = len(res.data or [])
            if n:
                print(f"🔧 已把上次中断遗留的 {n} 篇「评审中」作品退回待审。")
        except Exception as e:
            print(f"⚠️ 重置中断遗留作品失败（继续评审）: {e}")
        asyncio.run(run_batch_review())
    finally:
        _review_lock.release()


@router.post("/engine/start-review")
async def start_review_engine(
    background_tasks: BackgroundTasks,
    authorization: str = Header(None)
):
    verify_admin(authorization)
    # 2026-11-25：评审只能在当前主赛事截稿之后启动（未设截稿日期也不能启动）
    try:
        s = supabase_admin.table("site_settings").select("current_contest_id").eq("id", 1).maybe_single().execute()
        cid = ((s.data if s else None) or {}).get("current_contest_id")
        dl = None
        if cid:
            c = supabase_admin.table("contests").select("submission_deadline").eq("id", cid).maybe_single().execute()
            dl = ((c.data if c else None) or {}).get("submission_deadline")
    except Exception as e:
        print(f"⚠️ 读取截稿时间失败: {e}")
        raise HTTPException(status_code=500, detail="读取赛事截稿时间失败，请稍后重试")
    if not cid:
        raise HTTPException(status_code=403, detail="未设置当前主赛事，无法启动评审")
    if not dl:
        raise HTTPException(status_code=403, detail="当前主赛事尚未设置截稿日期，截稿后才能启动评审")
    if not deadline_passed(dl):
        raise HTTPException(status_code=403, detail=f"尚未截稿（截稿：{str(dl)[:10]}），截稿后才能启动评审")
    if _review_lock.locked():
        raise HTTPException(status_code=409, detail="已有一轮评审正在进行，请等它结束后再启动")
    background_tasks.add_task(run_contest_agent)
    return {"status": "success", "msg": "评审引擎已在后台启动"}


# 3. 全局策展
def run_curator_script():
    print("📊 接收到中控台指令，正在执行 Top 5% 全局策展...")
    auto_curate_top_percent()


@router.post("/engine/run-curation")
async def run_global_curation(
    background_tasks: BackgroundTasks,
    authorization: str = Header(None)
):
    verify_admin(authorization)
    background_tasks.add_task(run_curator_script)
    return {"status": "success", "msg": "全局策展正在执行"}


# 4. 重置卡死的评审（G）
#    流水线用原子锁把作品从 pending→processing；若某次评审中途崩溃，作品会永久停在
#    'processing'，占着唯一名额、选手既不能重投也等不到结果。此接口把它们退回 'pending'，
#    下次启动评审即可重新消费。⚠️ 仅在当前没有评审批次正在运行时使用，避免与在跑的批次抢。
@router.post("/engine/requeue-stuck")
async def requeue_stuck_reviews(authorization: str = Header(None)):
    verify_admin(authorization)
    if _review_lock.locked():
        raise HTTPException(status_code=409, detail="评审正在进行，不能重置；请等本轮结束后再操作")
    try:
        res = supabase_admin.table("contest_submissions") \
            .update({"status": "pending", "error_msg": None}) \
            .eq("status", "processing") \
            .execute()
        n = len(res.data or [])
        return {"status": "success", "msg": f"已将 {n} 篇卡在评审中的作品重置为待审", "count": n}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
