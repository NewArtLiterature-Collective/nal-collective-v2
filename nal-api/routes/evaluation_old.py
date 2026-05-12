from fastapi import APIRouter, Request, HTTPException
from services.pb_review_service import PBReviewService
# from services.ai_service import AIService # 引入你的文字评审服务

router = APIRouter(prefix="/api/v1/evaluate", tags=["Evaluation"])

@router.post("/process")
async def process_evaluation(request: Request):
    body = await request.json()
    
    task_type = body.get("task_type")
    work_text = body.get("work_text")
    user_role = body.get("user_role")
    
    # 在这里可以统一处理权限校验和额度扣减逻辑
    # ...
    
    try:
        if task_type == "illustration":
            image_urls = body.get("image_urls", [])
            image_type = body.get("image_type", "illustration")
            
            if not image_urls:
                raise HTTPException(status_code=400, detail="插画评审必须提供图片素材")
                
            report_content = await PBReviewService.evaluate_visual_work(
                image_urls=image_urls,
                script_text=work_text,
                work_type=image_type
            )
        else:
            model_db_id = body.get("model_db_id")
            # report_content = await AIService.evaluate_text_work(text=work_text, model_id=model_db_id)
            report_content = f"文字评审模块占位返回 (使用的模型ID: {model_db_id})" 
            
        return {"report": report_content}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))