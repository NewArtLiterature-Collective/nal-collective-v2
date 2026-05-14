import numpy as np
import json
from datetime import datetime
from services.user_service import supabase_admin
from services.literary_llm_service import LiteraryLLMService
from services.vision_llm_service import VisionLLMService

async def contest_pipeline(submission_id: str):
    """
    NAL 大赛全自动评审流水线
    """
    try:
        # 0. 获取作品详情
        res = supabase_admin.table("contest_submissions").select("*").eq("id", submission_id).single().execute()
        work = res.data
        if not work: return

        # --- 🛡️ Agent A: Gatekeeper (准入校验官) ---
        text = work.get("text_content", "")
        images = work.get("image_urls", [])
        word_count = len(text)

        if word_count < 800 or len(images) < 1:
            error_msg = f"物理校验未通过：字数({word_count})不足800或缺少插画({len(images)}幅)。"
            await update_status(submission_id, "invalid", error_msg)
            print(f"❌ 作品 {submission_id} 被退回: {error_msg}")
            return

        # --- 🧠 Agent B: Evaluator (学术评审官) ---
        await update_status(submission_id, "processing")
        print(f"🧠 Agent B 正在评审作品: {submission_id}...")

        # 1. 文本维度打分 (调用 Gemini 3.1 Pro)
        # 预设维度：文学底色、儿童生命本位、叙事创新、时代感
        eval_result = await LiteraryLLMService.evaluate_contest_work(text)
        scores = eval_result.get("scores", {}) # 例如 {"fantasy": 90, "reality": 15, ...}
        
        # 2. 计算争议度 (方差 Variance)
        # 我们用方差来衡量作品的“偏激程度”。方差越大，代表作品在不同维度上的表现越两极分化。
        score_values = list(scores.values())
        ai_variance = float(np.var(score_values)) 
        ai_total_score = float(np.mean(score_values))

        # 3. 结果写回数据库
        await supabase_admin.table("contest_submissions").update({
            "status": "success",
            "word_count": word_count,
            "ai_scores": scores,
            "ai_total_score": ai_total_score,
            "ai_variance": ai_variance,
            "ai_review": eval_result.get("review", ""),
            "error_msg": None
        }).eq("id", submission_id).execute()

        print(f"✅ 作品 {submission_id} 评审完成。总分: {ai_total_score:.2f}, 争议度: {ai_variance:.2f}")

    except Exception as e:
        print(f"🚨 流水线发生崩溃: {e}")
        await update_status(submission_id, "invalid", f"系统评审异常: {str(e)}")

async def update_status(sid, status, error=None):
    supabase_admin.table("contest_submissions").update({
        "status": status,
        "error_msg": error
    }).eq("id", sid).execute()
