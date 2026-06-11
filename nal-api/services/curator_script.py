import pandas as pd
from services.user_service import supabase_admin

def auto_curate_top_percent():
    print("🚀 开始全局策展分析...")

    # 1. 获取所有已评审成功的作品
    res = supabase_admin.table("contest_submissions") \
        .select("id, ai_total_score") \
        .eq("status", "success") \
        .execute()
    
    if not res.data:
        print("⚠️ 暂无已评审的作品。")
        return

    df = pd.DataFrame(res.data)
    
    # 2. 计算动态门槛：选取总分前 5% 的分界线 (第 95 百分位)
    threshold = df['ai_total_score'].quantile(0.95)
    print(f"📊 当前 Top 5% 门槛分为: {threshold:.2f}")

    # 3. 找出达标的 IDs
    top_ids = df[df['ai_total_score'] >= threshold]['id'].tolist()
    
    # 4. 批量更新数据库：将 exhibition_ready 设为 True
    # Supabase 批量更新逻辑：使用 .in_() 过滤器
    update_res = supabase_admin.table("contest_submissions") \
        .update({"exhibition_ready": True}) \
        .in_("id", top_ids) \
        .execute()
    
    print(f"✅ 成功将 {len(top_ids)} 部作品标记为入展就绪。")

if __name__ == "__main__":
    auto_curate_top_percent()