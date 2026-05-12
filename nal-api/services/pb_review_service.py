import httpx
import asyncio
import logging
from fastapi import HTTPException
from typing import List

logger = logging.getLogger(__name__)

class PBReviewService:
    PB_API_BASE = "https://pb-api.nal-ai.org/PB/api"

    @staticmethod
    async def evaluate_visual_work(
        image_urls: List[str], 
        script_text: str, 
        work_type: str
    ) -> str:
        
        mapped_work_type = "picture_book" if work_type == "picture-book" else "illustration"

        async with httpx.AsyncClient(timeout=45.0) as client:
            try:
                logger.info(f"🚀 向 v65 视觉引擎发送注入提示的任务: {len(image_urls)} 图")
                
                # ==========================================
                # 核心绝招：Prompt Injection (紧箍咒)
                # 强迫大模型不要敲真实回车，使用 \n 替代，保证 JSON 解析不崩溃
                # ==========================================
                anti_break_instruction = """
                【系统强制格式指令：请注意，你的输出将被后端的 json.loads() 严格解析。
                在撰写 "v65_synergy_report" 的长文时，绝对不允许敲击真实的回车键产生物理换行！
                如果你需要分段，请直接在文字中输出纯字符 "\\n"（斜杠加字母n）。
                必须保证最终输出是一个严格合法的单行 JSON 数据，切记！】
                """
                
                safe_script_text = script_text + anti_break_instruction

                payload = {
                    "work_type": mapped_work_type,
                    "script_text": safe_script_text,
                    "image_urls": image_urls
                }
                
                init_resp = await client.post(f"{PBReviewService.PB_API_BASE}/evaluate", json=payload)
                init_resp.raise_for_status() 
                
                row_id = init_resp.json().get("row_id")
                if not row_id:
                    raise HTTPException(status_code=502, detail="未能获取视觉引擎的任务 ID")

                logger.info(f"✅ 任务立项成功，档案 ID: {row_id}。开始轮询...")

                max_retries = 30  
                sleep_seconds = 5 
                
                for attempt in range(max_retries):
                    status_resp = await client.get(f"{PBReviewService.PB_API_BASE}/status/{row_id}")
                    
                    if status_resp.status_code == 200:
                        status_data = status_resp.json()
                        current_status = status_data.get("status")
                        
                        if current_status == "completed":
                            report = status_data.get("v65_synergy_report", "分析报告提取为空")
                            score = status_data.get("v65_visual_score", "N/A")
                            return f"【NAL v2.1.0 视觉协同引擎得分: {score}/10】\n\n{report}"
                        
                        elif current_status == "failed":
                            raise HTTPException(status_code=500, detail="远程绘本分析引擎处理崩溃。")
                    
                    # 等待 5 秒再次查询
                    await asyncio.sleep(sleep_seconds)
                
                raise HTTPException(status_code=504, detail="多模态分析引擎处理超时。")

            # 这里的 except 如果缩进不对或者漏掉，就会在文件末尾引发报错
            except httpx.RequestError as exc:
                logger.error(f"网络请求失败: {exc}")
                raise HTTPException(status_code=503, detail="无法连接到内部绘本网关。")