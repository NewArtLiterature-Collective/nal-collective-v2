# services/contest_agent.py
import sys
import numpy as np
import asyncio
from services.user_service import supabase_admin
from services.contest_literary_service import ContestLiteraryService
import httpx
from io import BytesIO
from PIL import Image

async def download_image(url_or_path: str):
    """
    NAL 存储桶专属下载器：
    完美咬合前端 getPublicUrl() 传过来的 'contest_works' 长网址，
    自动切片提取出纯文件名，利用 admin 权限走高速内网通道拉取。
    """
    try:
        BUCKET_NAME = "contest_works" 
        
        if not url_or_path.startswith("http://") and not url_or_path.startswith("https://"):
            storage_res = supabase_admin.storage.from_(BUCKET_NAME).download(url_or_path)
            return Image.open(BytesIO(storage_res))

        if f"/{BUCKET_NAME}/" in url_or_path:
            parts = url_or_path.split(f"/{BUCKET_NAME}/")
            if len(parts) > 1:
                filename = parts[1]
                storage_res = supabase_admin.storage.from_(BUCKET_NAME).download(filename)
                return Image.open(BytesIO(storage_res))

        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url_or_path)
            if resp.status_code == 200:
                return Image.open(BytesIO(resp.content))
            else:
                print(f"❌ 外部兜底图片网络请求失败，状态码: {resp.status_code}")
                
    except Exception as e:
        print(f"🚨 存储桶 [contest_works] 资产捕获崩溃 [{url_or_path}]: {e}")
    return None
    
async def contest_pipeline(submission_id: str):
    """
    NAL 大赛 Agent 流水线：竞争夺锁 -> 门槛校验 -> 三专家会诊 -> 计算争议 -> 入库
    """
    try:
        # 🚨 核心安全升级：原子夺锁机制
        lock_res = supabase_admin.table("contest_submissions") \
            .update({"status": "processing"}) \
            .eq("id", submission_id) \
            .eq("status", "pending") \
            .execute()
            
        if not lock_res.data:
            print(f"⏭️ 作品 {submission_id} 已被其他线程夺取或已完成，本流水线跳过。")
            return

        work = lock_res.data[0]

        text = work.get("text_content", "")
        images = work.get("image_urls", [])
        if images is None: 
            images = []

        print(f"🛠️ [DEBUG] 正在校验作品 {submission_id[:8]} ... 字数: {len(text)}, 图片数: {len(images)}")

        # --- Agent A: Gatekeeper (校验) ---
        if len(text) < 500 or len(images) < 1:
            error_detail = f"未达参赛门槛（系统检测到字数: {len(text)}, 图片数: {len(images)}）"
            await update_status(submission_id, "invalid", error_detail)
            return

        # 🚨 核心新增：统一全异步下载图片资产
        download_tasks = [download_image(url) for url in images]
        pil_images = await asyncio.gather(*download_tasks)
        valid_images = [img for img in pil_images if img is not None]

        if not valid_images:
            await update_status(submission_id, "invalid", "参赛插画资产解析失败或链接失效")
            return
        
        # --- Agent B: Evaluator (三专家会诊) ---
        print(f"🧠 正在调用 AI 专家组进行多维度并发会诊: {submission_id[:8]}")
        
        tasks = [
            ContestLiteraryService.evaluate_contest_work(text, valid_images, "panoramic"),
            ContestLiteraryService.evaluate_contest_work(text, valid_images, "nal_chief"),
            ContestLiteraryService.evaluate_contest_work(text, valid_images, "li_lifang")
        ]
        results = await asyncio.gather(*tasks)
        p_res, c_res, l_res = results[0], results[1], results[2]

        # 核心数学计算：汇总均分与离散度
        all_score_points = []
        combined_scores = {}
        for dim in p_res["scores"].keys():
            dim_vals = [p_res["scores"][dim], c_res["scores"][dim], l_res["scores"][dim]]
            combined_scores[dim] = float(np.mean(dim_vals))
            all_score_points.extend(dim_vals)

        ai_variance = float(np.var(all_score_points))
        ai_total_score = float(np.mean(all_score_points))

        final_review = (
            f"【全景视角】：{p_res['review']}\n\n"
            f"【首席锐评】：{c_res['review']}\n\n"
            f"【学术溯源】：{l_res['review']}"
        )

        supabase_admin.table("contest_submissions").update({
            "status": "success",
            "ai_scores": combined_scores,
            "ai_total_score": ai_total_score,
            "ai_variance": ai_variance,
            "ai_review": final_review,
            "word_count": len(text)
        }).eq("id", submission_id).execute()

        print(f"✅ 会诊完成: {submission_id[:8]} (争议度: {ai_variance:.2f})")

    except Exception as e:
        print(f"🚨 流水线崩溃: {e}")
        await update_status(submission_id, "invalid", str(e))

async def update_status(sid, status, error=None):
    supabase_admin.table("contest_submissions").update({
        "status": status,
        "error_msg": error
    }).eq("id", sid).execute()

async def run_batch_review():
    """
    云端一次性批处理引擎 (Batch Job)
    由 FastAPI 前端按钮唤醒，拉取所有待审作品，评完立刻安全退出。
    """
    print("🚀 [NAL 离线评审引擎] 启动！正在扫描数据库...")
    
    try:
        # 1. 一次性查出所有 pending 的作品 ID
        res = supabase_admin.table("contest_submissions") \
            .select("id") \
            .eq("status", "pending") \
            .execute()
            
        pending_works = res.data
        
        # 🚨 防线：如果没有活儿干，直接杀进程撤退
        if not pending_works:
            print("🏁 [NAL 离线评审引擎] 侦测到当前没有待评审的作品，任务结束。")
            sys.exit(0)
            
        print(f"📊 发现 {len(pending_works)} 篇待评审作品，开始注入 AI 算力...")
        
        # 2. 顺序送入流水线
        # 使用 for 循环顺序等待，而不是全量并发，防止 Gemini 报 429 限流，并保护 Render 内存
        for index, work in enumerate(pending_works, 1):
            target_id = work['id']
            print(f"\n--- 正在处理第 {index}/{len(pending_works)} 篇 ---")
            await contest_pipeline(target_id)
            
        print("\n🎉 [NAL 离线评审引擎] 当前批次所有作品已全部处理完毕！")
        
    except Exception as e:
        print(f"🚨 批处理引擎发生致命错误: {e}")

if __name__ == "__main__":
    # 删除了轮询的 main_worker，直接执行批处理任务
    asyncio.run(run_batch_review())
