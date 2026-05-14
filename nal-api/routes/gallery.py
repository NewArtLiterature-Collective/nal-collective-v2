from fastapi import APIRouter, HTTPException
from services.user_service import supabase_admin

router = APIRouter(prefix="/gallery", tags=["Exhibition"])

@router.get("/exhibition")
async def get_exhibition_works():
    """
    展厅核心接口：实时从数据库中选拔三类作品
    1. 争议作品 (Controversial): 方差最大
    2. AI推荐 (AI Recommended): 总分最高
    3. 人工推荐 (Curator's Choice): 手动勾选
    """
    try:
        # 1. 选拔【争议作品】：筛选已完成评审且得分方差最高的 5 部
        # 逻辑：方差 $$ \sigma^2 $$ 越大，代表专家分歧越大或作品“偏科”越严重
        controversial_res = supabase_admin.table("contest_submissions") \
            .select("*") \
            .eq("status", "success") \
            .order("ai_variance", desc=True) \
            .limit(5) \
            .execute()

        # 2. 选拔【AI推荐】：筛选综合得分（均分）最高的 5 部
        ai_recommended_res = supabase_admin.table("contest_submissions") \
            .select("*") \
            .eq("status", "success") \
            .order("ai_total_score", desc=True) \
            .limit(5) \
            .execute()

        # 3. 选拔【人工推荐】：筛选被标注为推荐的作品，按权重或时间排序
        manual_res = supabase_admin.table("contest_submissions") \
            .select("*") \
            .eq("is_manual_recommended", True) \
            .order("manual_rank", desc=True) \
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
