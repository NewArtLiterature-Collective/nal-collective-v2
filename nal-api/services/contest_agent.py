import numpy as np
import json
import asyncio  # 🚨 新增：用于处理并行调用
from datetime import datetime
from services.user_service import supabase_admin
from services.literary_llm_service import LiteraryLLMService
from services.vision_llm_service import VisionLLMService

async def contest_pipeline(submission_id: str):
    """
    NAL 大赛全自动评审流水线 - 三专家会诊版本
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

        # --- 🧠 Agent B: Evaluator (学术评审官 - 三人小组) ---
        await update_status(submission_id, "processing")
        print(f"🧠 Agent B 专家组正在会诊作品: {submission_id}...")

        # 1. 🚨 并发调用三个专家模型 (全景、首席、李利芳)
        # 注意：这里假设 LiteraryLLMService 已经实现了支持不同 identity 的调用方法
        tasks = [
            LiteraryLLMService.evaluate_contest_work(text, persona="panoramic"),
            LiteraryLLMService.evaluate_contest_work(text, persona="nal_chief"),
            LiteraryLLMService.evaluate_contest_work(text, persona="li_lifang")
        ]
        
        # 并行执行，大幅缩短评审等待时间
        results = await asyncio.gather(*tasks)
        
        panoramic_res = results[0]  # 全景模型结果
        chief_res = results[1]      # 首席模型结果
        lifang_res = results[2]     # 李利芳模型结果

        # 2. 核心：计算综合分数与争议度
        # 我们收集所有专家给出的所有维度分，放入一个大数组计算方差
        all_score_values = []
        combined_scores = {} # 汇总后的维度均分，用于数据库展示
        
        # 提取并汇总维度分 (假设各专家返回的维度键名一致)
        all_dimensions = panoramic_res.get("scores", {}).keys()
        for dim in all_dimensions:
            dim_scores = [
                panoramic_res.get("scores", {}).get(dim, 0),
                chief_res.get("scores", {}).get(dim, 0),
                lifang_res.get("scores", {}).get(dim, 0)
            ]
            combined_scores[dim] = float(np.mean(dim_scores)) # 该维度的专家平均分
            all_score_values.extend(dim_scores)

        # 计算争议度 (方差 Variance)
        # 争议度越高，说明：a)作品偏科严重 或 b)专家之间分歧巨大
        ai_variance = float(np.var(all_score_values)) 
        ai_total_score = float(np.mean(all_score_values))

        # 3. 🚨 综合评审意见 (由“终审 Agent”汇总三方评语)
        # 这里可以简单拼接，或者再调用一次极简的 LLM 进行总结（目前先采用拼接逻辑）
        combined_review = (
            f"【全景视角】：{panoramic_res.get('review', '')}\n\n"
            f"【首席锐评】：{chief_res.get('review', '')}\n\n"
            f"【学术溯源】：{lifang_res.get('review', '')}"
        )

        # 4. 结果写回数据库
        await supabase_admin.table("contest_submissions").update({
            "status": "success",
            "word_count": word_count,
            "ai_scores": combined_scores,
            "ai_total_score": ai_total_score,
            "ai_variance": ai_variance,
            "ai_review": combined_review,
            "error_msg": None
        }).eq("id", submission_id).execute()

        print(f"✅ 作品 {submission_id} 三方会诊完成。总分: {ai_total_score:.2f}, 争议度: {ai_variance:.2f}")

    except Exception as e:
        print(f"🚨 流水线发生崩溃: {e}")
        await update_status(submission_id, "invalid", f"系统评审异常: {str(e)}")

async def update_status(sid, status, error=None):
    supabase_admin.table("contest_submissions").update({
        "status": status,
        "error_msg": error
    }).eq("id", sid).execute()
