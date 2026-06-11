# routers/admin.py
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from services.user_service import supabase_admin
import subprocess

router = APIRouter(prefix="/admin", tags=["Admin Control"])

class TimeSettings(BaseModel):
    start_time: str
    end_time: str

# 1. 拨动时空大闸：更新展厅时间
@router.post("/settings/gallery-time")
async def update_gallery_time(settings: TimeSettings):
    try:
        res = supabase_admin.table("site_settings").update({
            "gallery_start_time": settings.start_time,
            "gallery_end_time": settings.end_time
        }).eq("id", 1).execute() # 假设 settings 表只有 1 行，id 为 1
        return {"status": "success", "msg": "展厅时空大闸已更新"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. 调度核心：触发离线评审引擎 (后台静默运行)
def run_contest_agent():
    # 使用 subprocess 启动你之前写好的守护进程
    # 注意：在正式服务器上，这通常由 systemd 或 Docker 管理，这里提供一个 API 触发的快捷方式
    print("⚡ 接收到中控台指令，正在唤醒 AI 评审引擎...")
    subprocess.Popen(["python", "-m", "services.contest_agent"])

@router.post("/engine/start-review")
async def start_review_engine(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_contest_agent)
    return {"status": "success", "msg": "评审引擎已在后台启动，请留意数据库状态变化。"}

# 3. 调度核心：执行全局动态策展 (Top 5%)
def run_curator_script():
    print("📊 接收到中控台指令，正在执行 Top 5% 全局策展...")
    subprocess.run(["python", "services/curator_script.py"]) # 运行我们刚刚写的那个离线脚本

@router.post("/engine/run-curation")
async def run_global_curation(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_curator_script)
    return {"status": "success", "msg": "全局策展正在执行，符合条件的作品将被打上金标。"}