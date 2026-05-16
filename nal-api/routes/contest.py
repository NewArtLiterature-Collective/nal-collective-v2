from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone
import asyncio
from services.user_service import supabase_admin
from services.contest_agent import contest_pipeline  # 🚨 引入你的 Agent 流水线方法

router = APIRouter()

@router.post("/api/v1/contest/submit")
async def submit_contest_work(user_id: str, title: str, text: str, images: list):
    try:
        # 🚨 1. 拦截安全线：去后台查询动态配置（截稿时间）
        settings_res = supabase_admin.table("site_settings").select("submission_deadline").single().execute()
        if not settings_res.data:
            raise HTTPException(status_code=500, detail="系统配置丢失，暂时无法提交")
            
        deadline_str = settings_res.data.get("submission_deadline")
        if deadline_str:
            # 兼容带 Z 或不带 Z 的标准 UTC 时间转换
            deadline_dt = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > deadline_dt:
                return {"success": False, "msg": "⏰ 本届大奖赛投稿通道已于截稿日期截止，感谢您的关注！"}

        # 2. 写入数据库（状态初始化为 'pending'）
        insert_res = supabase_admin.table("contest_submissions").insert({
            "user_id": user_id,
            "title": title,
            "text_content": text,
            "image_urls": images,
            "status": "pending"
        }).execute()
        
        if not insert_res.data:
            return {"success": False, "msg": "作品入库失败"}
            
        new_submission_id = insert_res.data[0]["id"]

        # 🚨 3. 即时唤醒机制：无需等待轮询器，直接丢进事件循环，进行后台异步评审
        asyncio.create_task(contest_pipeline(new_submission_id))

        return {
            "success": True, 
            "msg": "作品提交成功！AI 多专家会诊流水线已即时唤醒，请稍后在控制台查看评审报告。",
            "submission_id": new_submission_id
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
