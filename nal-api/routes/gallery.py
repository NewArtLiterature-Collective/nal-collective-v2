@router.get("/exhibition")
async def get_gallery_content():
    """
    Agent C: 策展逻辑实现。
    """
    # 1. 争议作品：筛选方差最高的前 5 名 (表现极端的作品)
    controversial = supabase.table("contest_submissions") \
        .select("*").eq("status", "success") \
        .order("ai_variance", desc=True).limit(5).execute()

    # 2. AI 推荐：筛选总分最高的前 5 名 (综合素质最优)
    ai_picks = supabase.table("contest_submissions") \
        .select("*").eq("status", "success") \
        .order("ai_total_score", desc=True).limit(5).execute()

    # 3. 人工推荐：读取后台手动勾选的 5 名
    manual_picks = supabase.table("contest_submissions") \
        .select("*").eq("is_manual", True) \
        .order("created_at", desc=True).limit(5).execute()

    return {
        "controversial": controversial.data,
        "ai_recommended": ai_picks.data,
        "manual_picks": manual_picks.data
    }
