# services/contest_agent.py
import numpy as np
import asyncio
from services.user_service import supabase_admin
from services.literary_llm_service import contest_LiteraryLLMService

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
