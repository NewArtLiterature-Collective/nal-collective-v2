# routes/admin.py
import asyncio
from fastapi import APIRouter, BackgroundTasks, HTTPException, Header
from pydantic import BaseModel
from services.user_service import supabase_admin
from services.contest_agent import run_batch_review
from services.curator_script import auto_curate_top_percent
from core.config import settings

router = APIRouter(prefix="/admin", tags=["Admin Control"])

class TimeSettings(BaseModel):
    start_time: str
    end_time: str

# 复用的鉴权检查
def verify_admin(x_admin_key: str):
    print(f"🔑 收到的 admin key: [{x_admin_key}]")  # 临时加这行
    print(f"🔑 期望的 admin key: [{settings.ADMIN_SECRET_KEY}]")  # 临时加这行
    if x_admin_key != settings.ADMIN_SECRET_KEY:
        raise HTTPException(status_code=403, detail="无权限")

# 1. 时空大闸
@router.post("/settings/gallery-time")
async def update_gallery_time(settings_data: TimeSettings, x_admin_key: str = Header(None)):
    verify_admin(x_admin_key)
    try:
        supabase_admin.table("site_settings").update({
            "gallery_start_time": settings_data.start_time,
            "gallery_end_time": settings_data.end_time
        }).eq("id", 1).execute()
        return {"status": "success", "msg": "展厅时空大闸已更新"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. 评审引擎
def run_contest_agent():
    print("⚡ 接收到中控台指令，正在唤醒 AI 评审引擎...")
    asyncio.run(run_batch_review())

@router.post("/engine/start-review")
async def start_review_engine(
    background_tasks: BackgroundTasks,
    x_admin_key: str = Header(None)
):
    verify_admin(x_admin_key)
    background_tasks.add_task(run_contest_agent)
    return {"status": "success", "msg": "评审引擎已在后台启动"}

# 3. 全局策展
def run_curator_script():
    print("📊 接收到中控台指令，正在执行 Top 5% 全局策展...")
    auto_curate_top_percent()

@router.post("/engine/run-curation")
async def run_global_curation(
    background_tasks: BackgroundTasks,
    x_admin_key: str = Header(None)
):
    verify_admin(x_admin_key)
    background_tasks.add_task(run_curator_script)
    return {"status": "success", "msg": "全局策展正在执行"}
