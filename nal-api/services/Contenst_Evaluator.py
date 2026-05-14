import numpy as np

async def evaluator_agent(submission_id: str, text: str, images: list):
    """
    Agent B: 文学与视觉评估。
    计算核心：利用方差识别“争议作品”。
    """
    # 1. 调用 LiteraryLLMService 获取维度打分
    # 假设返回结果：{'fantasy': 95, 'reality': 20, 'character': 90, 'logic': 15}
    results = await ContestLiteraryService.get_multi_dimensional_scores(text)
    
    scores = results['scores']
    score_values = list(scores.values())
    
    # 2. 计算争议度 (方差)
    # 方差越大的作品，代表“偏科”极其严重，属于典型的 NAL 争议先锋作品
    variance = float(np.var(score_values)) 
    total_score = float(np.mean(score_values))

    await update_db(submission_id, {
        "status": "completed",
        "ai_scores": scores,
        "ai_variance": variance,
        "ai_total_score": total_score,
        "ai_review": results['review'] # AI 生成的点评
    })
