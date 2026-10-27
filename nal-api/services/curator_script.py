# services/curator_script.py
import math
from services.user_service import supabase_admin

# 策展口径（按赛事章程调整）
TOP_PERCENT = 0.05   # 取总分前 5%
MIN_WINNERS = 3      # 小样本兜底：至少入展这么多（不足 MIN_WINNERS 篇则全部入展）


def auto_curate_top_percent():
    """
    全局策展：对【当前主赛事】已评审成功的作品，按总分名次 + 小样本兜底选出入展集合。
    关键修复：
      1) 只处理 current_contest_id 对应的赛事（不再跨赛事混算）。
      2) 可反复安全重跑：每次先把本赛事旧的自动入展标记清零，再按最新分数重标；
         掉出榜单的会被自动撤下（不再“只增不减”）。人工推荐(is_manual_recommended)不受影响。
      3) 用“名次制 + 兜底”取代会在小样本下失真的 quantile 分位线；边界并列全部纳入。
    （本函数用 service_role 执行，绕过 RLS。）
    """
    print("🚀 开始全局策展分析...")

    # 1. 锁定当前主赛事
    s = supabase_admin.table("site_settings").select("current_contest_id").eq("id", 1).single().execute()
    contest_id = (s.data or {}).get("current_contest_id")
    if not contest_id:
        print("⚠️ 未设置当前主赛事 current_contest_id，策展中止。")
        return

    # 2. 取该赛事所有已评审成功的作品
    res = supabase_admin.table("contest_submissions") \
        .select("id, ai_total_score") \
        .eq("status", "success") \
        .eq("contest_id", contest_id) \
        .execute()
    rows = res.data or []
    if not rows:
        print(f"⚠️ 赛事 {contest_id} 暂无已评审成功的作品。")
        return

    # 3. 先清零本赛事旧的自动入展标记（可反复重跑；不动人工推荐）
    supabase_admin.table("contest_submissions") \
        .update({"exhibition_ready": False}) \
        .eq("contest_id", contest_id) \
        .eq("status", "success") \
        .execute()

    # 4. 名次制 + 小样本兜底
    #    k = min(n, max(MIN_WINNERS, ceil(n * TOP_PERCENT)))
    #    取总分降序前 k 名的分数为门槛，门槛分并列者全部纳入（避免并列被任意截断）。
    scored = sorted(rows, key=lambda r: (r.get("ai_total_score") or 0), reverse=True)
    n = len(scored)
    k = min(n, max(MIN_WINNERS, math.ceil(n * TOP_PERCENT)))
    threshold = scored[k - 1].get("ai_total_score") or 0
    winner_ids = [r["id"] for r in scored if (r.get("ai_total_score") or 0) >= threshold]

    # 5. 标记入展
    if winner_ids:
        supabase_admin.table("contest_submissions") \
            .update({"exhibition_ready": True}) \
            .in_("id", winner_ids) \
            .execute()

    print(f"✅ 赛事 {contest_id}：共 {n} 篇，入展 {len(winner_ids)} 篇（入展门槛分 {threshold:.2f}）。")


if __name__ == "__main__":
    auto_curate_top_percent()
