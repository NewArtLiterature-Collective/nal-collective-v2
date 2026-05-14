import numpy as np
from services.user_service import supabase_admin # 🚨 导入数据库客户端
from services.contest_literary_service import ContestLiteraryService # 🚨 导入评审服务

async def update_db(sid, data):
    """辅助函数：更新数据库"""
    return supabase_admin.table("contest_submissions").update(data).eq("id", sid).execute()

async def evaluator_agent(submission_id: str, text: str, images: list):
    """
    Agent B: 文学与视觉评估。
    计算核心：利用方差识别“争议作品”。
    """
    try:
        # 1. 调用 ContestLiteraryService 获取维度打分
        # 🚨 确保类名与 literary_llm_service.py 中定义的一致
        print(f"🧠 正在调用 AI 专家进行多维度打分: {submission_id}")
        
        # 注意：这里调用的是 get_multi_dimensional_scores 或你定义的 evaluate_contest_work
        # 建议根据你 literary_llm_service.py 里的实际方法名调整
        results = await ContestLiteraryService.evaluate_contest_work(text)
        
        scores = results['scores']
        score_values = list(scores.values())
        
        # 2. 计算争议度 (方差)
        # 方差越大的作品，代表“偏科”极其严重
        variance = float(np.var(score_values)) 
        total_score = float(np.mean(score_values))

        # 3. 更新数据库状态为已完成
        await update_db(submission_id, {
            "status": "success", # 对应前端显示的“已入选”
            "ai_scores": scores,
            "ai_variance": variance,
            "ai_total_score": total_score,
            "ai_review": results['review'] 
        })
        
        print(f"✅ 作品 {submission_id} 评估入库成功")

    except Exception as e:
        print(f"🚨 评估过程出错: {e}")
        # 如果出错，更新状态为 invalid
        await update_db(submission_id, {
            "status": "invalid",
            "error_msg": str(e)
        })
