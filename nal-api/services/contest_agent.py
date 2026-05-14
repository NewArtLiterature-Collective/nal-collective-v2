# services/contest_agent.py
import numpy as np
import asyncio
from services.user_service import supabase_admin
from services.contest_literary_service import ContestLiteraryService

async def contest_pipeline(submission_id: str):
    """
    NAL 大赛 Agent 流水线：校验 -> 三专家会诊 -> 计算争议 -> 入库
    """
    try:
        # 1. 获取作品
        res = supabase_admin.table("contest_submissions").select("*").eq("id", submission_id).single().execute()
        work = res.data
        if not work: return

        text = work.get("text_content", "")
        images = work.get("image_urls", [])

        # --- Agent A: Gatekeeper (校验) ---
        if len(text) < 800 or len(images) < 1:
            await update_status(submission_id, "invalid", "未达参赛门槛（800字+1幅插画）")
            return

        # --- Agent B: Evaluator (三专家会诊) ---
        await update_status(submission_id, "processing")
        
        # 并发执行三方评审
        tasks = [
            LiteraryLLMService.evaluate_contest_work(text, "panoramic"),
            LiteraryLLMService.evaluate_contest_work(text, "nal_chief"),
            LiteraryLLMService.evaluate_contest_work(text, "li_lifang")
        ]
        results = await asyncio.gather(*tasks)
        
        p_res, c_res, l_res = results[0], results[1], results[2]

        # 2. 核心数学计算：汇总均分与离散度
        all_score_points = []
        combined_scores = {}
        for dim in p_res["scores"].keys():
            dim_vals = [p_res["scores"][dim], c_res["scores"][dim], l_res["scores"][dim]]
            combined_scores[dim] = float(np.mean(dim_vals)) # 维度均分
            all_score_points.extend(dim_vals)

        # 争议指标 (方差)
        ai_variance = float(np.var(all_score_points))
        ai_total_score = float(np.mean(all_score_points))

        # 3. 构造简洁的专家评语展示
        # 这种格式方便前端直接 split('\n\n') 或解析标签
        final_review = (
            f"【全景视角】：{p_res['review']}\n\n"
            f"【首席锐评】：{c_res['review']}\n\n"
            f"【学术溯源】：{l_res['review']}"
        )

        # 4. 回写数据库
        await supabase_admin.table("contest_submissions").update({
            "status": "success",
            "ai_scores": combined_scores,
            "ai_total_score": ai_total_score,
            "ai_variance": ai_variance,
            "ai_review": final_review,
            "word_count": len(text)
        }).eq("id", submission_id).execute()

        print(f"✅ 会诊完成: {submission_id} (争议度: {ai_variance:.2f})")

    except Exception as e:
        print(f"🚨 流水线崩溃: {e}")
        await update_status(submission_id, "invalid", str(e))

async def update_status(sid, status, error=None):
    supabase_admin.table("contest_submissions").update({
        "status": status,
        "error_msg": error
    }).eq("id", sid).execute()

async def main_worker():
    """
    长驻轮询器：每 10 秒扫描一次数据库中的 'pending' 作品
    """
    print("🏛️ NAL 专家评审 Agent 启动，正在监听待处理作品...")
    
    while True:
        try:
            # 1. 查找一个待处理的作品
            # 我们只需要拉取 ID 即可，pipeline 内部会重新拉取完整数据
            res = supabase_admin.table("contest_submissions") \
                .select("id") \
                .eq("status", "pending") \
                .limit(1) \
                .execute()

            if res.data:
                target_id = res.data[0]['id']
                print(f"🔍 发现新投稿 {target_id}，启动流水线...")
                
                # 2. 执行你写的流水线
                await contest_pipeline(target_id)
            
            # 3. 适当休息，避免给数据库造成太大压力
            await asyncio.sleep(10)
            
        except Exception as e:
            print(f"❌ 轮询异常: {e}")
            await asyncio.sleep(30) # 报错后多歇一会

if __name__ == "__main__":
    # 启动异步事件循环
    asyncio.run(main_worker())
