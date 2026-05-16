# services/contest_agent.py
import numpy as np
import asyncio
from services.user_service import supabase_admin
from services.contest_literary_service import ContestLiteraryService
import httpx
from io import BytesIO
from PIL import Image

async def download_image(url: str):
    """异步下载图片并转换为 PIL 对象，供 Gemini 视觉识别"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                return Image.open(BytesIO(resp.content))
    except Exception as e:
        print(f"⚠️ 图片下载失败 {url}: {e}")
    return None
    
async def contest_pipeline(submission_id: str):
    """
    NAL 大赛 Agent 流水线：竞争夺锁 -> 门槛校验 -> 三专家会诊 -> 计算争议 -> 入库
    """
    try:
        # 🚨 核心安全升级：原子夺锁机制（彻底粉碎 API 实时唤醒与长驻轮询器的毫秒级撞车）
        # 尝试将当前作品的状态从 'pending' 原子改写为 'processing'。
        # 如果 lock_res.data 为空，说明别的线程（比如实时 API 或另一个 Worker）已经抢先把它叼走了。
        lock_res = supabase_admin.table("contest_submissions") \
            .update({"status": "processing"}) \
            .eq("id", submission_id) \
            .eq("status", "pending") \
            .execute()
            
        if not lock_res.data:
            print(f"⏭️ 作品 {submission_id} 已被其他评审线程夺取或已完成，本线程自动安全退出。")
            return

        # 1. 直接从锁返回的最新数据里提取作品内容（精妙处：直接省去了原本下面的 select(*) 数据库请求！）
        work = lock_res.data[0]

        text = work.get("text_content", "")
        images = work.get("image_urls", [])

        # --- Agent A: Gatekeeper (校验) ---
        if len(text) < 800 or len(images) < 1:
            await update_status(submission_id, "invalid", "未达参赛门槛（800字+1幅插画）")
            return

        # 🚨 核心新增：统一全异步下载图片资产（只下载一次！）
        download_tasks = [download_image(url) for url in image_urls]
        pil_images = await asyncio.gather(*download_tasks)
        # 过滤掉下载失败的坏图
        valid_images = [img for img in pil_images if img is not None]

        if not valid_images:
            await update_status(submission_id, "invalid", "参赛插画资产解析失败或链接失效")
            return
        
        # --- Agent B: Evaluator (三专家会诊) ---
        # 💡 注意：上面夺锁时已经把状态改成 "processing" 了，这里不需要再重复 update_status 了
        print(f"🧠 正在调用 AI 专家组进行多维度并发会诊: {submission_id}")
        
        # 并发执行三方评审
        tasks = [
            ContestLiteraryService.evaluate_contest_work(text, "panoramic"),
            ContestLiteraryService.evaluate_contest_work(text, "nal_chief"),
            ContestLiteraryService.evaluate_contest_work(text, "li_lifang")
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
        final_review = (
            f"【全景视角】：{p_res['review']}\n\n"
            f"【首席锐评】：{c_res['review']}\n\n"
            f"【学术溯源】：{l_res['review']}"
        )

        # 4. 回写数据库
        supabase_admin.table("contest_submissions").update({
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
    长驻轮询器：每 10 秒扫描一次数据库中的 'pending' 作品（安全的兜底漏网之鱼）
    """
    print("🏛️ NAL 专家评审 Agent 启动，正在监听待处理作品...")
    
    while True:
        try:
            # 1. 查找一个待处理的作品
            res = supabase_admin.table("contest_submissions") \
                .select("id") \
                .eq("status", "pending") \
                .limit(1) \
                .execute()

            if res.data:
                target_id = res.data[0]['id']
                print(f"🔍 轮询兜底器发现新投稿 {target_id}，尝试唤醒流水线...")
                
                # 2. 扔进流水线（内部的原子锁会确保它不会跟 API 实时线程撞车）
                await contest_pipeline(target_id)
            
            await asyncio.sleep(10)
            
        except Exception as e:
            print(f"❌ 轮询异常: {e}")
            await asyncio.sleep(30)

if __name__ == "__main__":
    asyncio.run(main_worker())
