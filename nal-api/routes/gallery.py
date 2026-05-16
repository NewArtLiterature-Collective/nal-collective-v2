from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone
from services.user_service import supabase_admin

router = APIRouter(prefix="/gallery", tags=["Exhibition"])

@router.get("/exhibition")
async def get_exhibition_works():
    """
    展厅核心接口：实时从数据库中选拔三类作品（融入时空大闸与数据安全净化锁）
    1. 争议作品 (Controversial): 方差最大
    2. AI推荐 (AI Recommended): 总分最高
    3. 人工推荐 (Curator's Choice): 手动勾选 + 动态权重排序
    """
    try:
        # 🚨 1. 开启时空大闸：判断当前是否在后台设定的展示时间内
        settings_res = supabase_admin.table("site_settings") \
            .select("gallery_start_time", "gallery_end_time").single().execute()
            
        if settings_res.data:
            start_str = settings_res.data.get("gallery_start_time")
            end_str = settings_res.data.get("gallery_end_time")
            
            if start_str and end_str:
                now = datetime.now(timezone.utc)
                # 统一转换为带 UTC 时区的 datetime 结构进行安全对撞
                start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                
                # 如果当前时间不在展示天数区间内，铁腕锁定大门，不向前端暴露任何作品数据
                if now < start_dt or now > end_dt:
                    return {
                        "status": "closed", 
                        "msg": f"🏛️ 数字化展厅暂未开放。本期展览开放时间：{start_dt.strftime('%Y-%m-%d')} 至 {end_dt.strftime('%Y-%m-%d')}",
                        "data": {
                            "controversial": [],
                            "ai_recommended": [],
                            "manual_recommended": []
                        }
                    }

        # 🚨 2. 安全净化线：所有维度必须严格限制 status == "success"，确保只捞取评审成功的完整作品
        
        # 【维度 1】：选拔【争议作品】—— 筛选已完成评审且得分方差最高的 5 部
        # 逻辑：方差 $$ \sigma^2 $$ 越大，代表专家分歧越大或作品“偏科”越严重
        controversial_res = supabase_admin.table("contest_submissions") \
            .select("*") \
            .eq("status", "success") \
            .order("ai_variance", desc=True) \
            .limit(5) \
            .execute()

        # 【维度 2】：选拔【AI推荐】—— 筛选综合得分（均分）最高的 5 部
        ai_recommended_res = supabase_admin.table("contest_submissions") \
            .select("*") \
            .eq("status", "success") \
            .order("ai_total_score", desc=True) \
            .limit(5) \
            .execute()

        # 【维度 3】：选拔【人工推荐】—— 完美咬合现有推荐标签与排序权重
        # 排序修正：将 manual_rank 改为 desc=False（升序），确保 Rank 1, 2, 3 的重磅作品列队排在最前列
        manual_res = supabase_admin.table("contest_submissions") \
            .select("*") \
            .eq("status", "success") \
            .eq("is_manual_recommended", True) \
            .order("manual_rank", desc=False) \
            .order("created_at", desc=True) \
            .limit(5) \
            .execute()

        return {
            "status": "success",
            "data": {
                "controversial": controversial_res.data or [],
                "ai_recommended": ai_recommended_res.data or [],
                "manual_recommended": manual_res.data or []
            }
        }

    except Exception as e:
        print(f"🚨 展厅数据获取失败: {str(e)}")
        raise HTTPException(status_code=500, detail="无法获取展厅内容，请稍后再试。")
