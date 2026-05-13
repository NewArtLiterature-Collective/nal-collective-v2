# nal-api/routes/evaluation.py
from fastapi import APIRouter, Request, HTTPException, Header, Form, File, UploadFile
from typing import Optional
import io
import json
import datetime
from docx import Document

# 引入原有的用户服务和数据库配置
from services.user_service import supabase_admin
# 引入新创建的专业文学与视觉服务
from services.literary_llm_service import LiteraryLLMService
from services.vision_llm_service import VisionLLMService

router = APIRouter(prefix="/api/v1/evaluate", tags=["Evaluation"])

@router.post("/process")
async def process_evaluation(
    request: Request,
    authorization: str = Header(None),
    task_type: str = Form(...),
    user_role: str = Form(...),
    work_text: str = Form(""),
    image_type: str = Form(""),
    image_urls: str = Form("[]"),
    has_pro_limit: str = Form("false"),
    file: UploadFile = File(None)
):
    # ==========================================
    # 1. 身份验证与权限校验 (完整保留原有逻辑)
    # ==========================================
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少身份验证")
    
    token = authorization.split(" ")[1]

    try:
        user_res = supabase_admin.auth.get_user(token)
        if not user_res or not user_res.user:
            raise Exception("会话无效")
        user = user_res.user
        metadata = user.user_metadata or {}
    except Exception as e:
        raise HTTPException(status_code=401, detail="身份验证失败，请重新登录")

    # ==========================================
    # 2. 文本解析与预处理 (支持 Word 上传)
    # ==========================================
    extracted_text = work_text
    if task_type == "text" and file and file.filename.endswith('.docx'):
        try:
            content = await file.read()
            doc = Document(io.BytesIO(content))
            extracted_text = "\n".join([p.text for p in doc.paragraphs])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"解析 Word 文档失败: {e}")

    # ==========================================
    # 3. 商业路由：决定算力模型 (3.1 Pro / 2.5 Pro / 2.5 Flash)
    # ==========================================
    task = task_type
    role = metadata.get("role", "free")
    flash_left = metadata.get("flash_left", 5)
    pro_left = metadata.get(f"{task}_pro", 0)
    
    today_str = datetime.date.today().isoformat()
    last_active = metadata.get("last_active_date", "")
    pro_daily_used = metadata.get("pro_daily_used", 0)

    # 跨天重置 Pro 每日用量
    if last_active != today_str:
        pro_daily_used = 0

    target_model = "gemini-2.5-flash" # 默认兜底
    used_pro_quota = False            # 是否消耗了参赛选手额度
    used_pro_daily = False            # 是否消耗了 Pro 每日 3.1 额度
    
    if role == "pro":
        if pro_daily_used < 10:
            target_model = "gemini-3.1-pro-preview" # 只有专业选手在额度内能用 3.1
            used_pro_daily = True
        else:
            target_model = "gemini-2.5-flash" # 超出后自动降级
    elif role == "contestant" and pro_left > 0:
        target_model = "gemini-2.5-pro" # 参赛选手使用 2.5 Pro
        used_pro_quota = True
    elif flash_left > 0:
        target_model = "gemini-2.5-flash"
    else:
        raise HTTPException(status_code=403, detail="额度已耗尽，请充值。")

    # ==========================================
    # 4. 调用 AI 核心 (根据 task_type 分发至不同专业 Service)
    # ==========================================
    report = ""
    try:
        # --- 任务 A: 创作指导伴侣 ---
        if task_type == "guide":
            # 严格保留会员字数权益设定
            if role == "pro":
                snippet_rule = "【权限特供】：在大纲之后，请务必提供大约 800 字的高深文学性高光片段试写。"
            elif role == "contestant" or has_pro_limit == "true":
                snippet_rule = "【参赛权益】：在大纲之后，请提供大约 300 字的高光片段试写。"
            else:
                snippet_rule = "【权限拦截】：本次指导仅提供结构性创作大纲，严禁输出任何具体的试写片段内容。"

            report = await LiteraryLLMService.generate_creative_guide(
                user_prompt=extracted_text,
                mentor_desc="资深的儿童文学策展人与创作导师风格",
                focus_dimensions="原创精神、文学底色、本土特色内核",
                snippet_rule=snippet_rule,
                target_model=target_model
            )

        # --- 任务 B: 文学作品深度评审 ---
        elif task_type == "text":
            # 这里接入 V1 版本极其犀利的“自适应调权评审”逻辑
            report = await LiteraryLLMService.evaluate_work(
                raw_text=extracted_text,
                selected_model="NAL-首席专家锐评模型", # 可由前端传参动态决定
                base_weights={"fantasy": 25, "reality": 30, "character": 45}, # 基础权重
                model_system_instruction="你是一位严谨的儿童文学理论评论家。请指出刻板说教和“人造儿童”现象。",
                user_note="请重点关注文本的原创性与叙事深度",
                target_model=target_model
            )
            
        # --- 任务 C: 绘本与插画视觉评审 ---
        elif task_type == "illustration":
            try:
                urls_list = json.loads(image_urls)
            except:
                urls_list = []
            
            # 接入 V6.5 视觉代偿与双轨制评审逻辑
            report = await VisionLLMService.evaluate_visual_work(
                target_model=target_model,
                image_type=image_type, # "picture-book" 或 "illustration"
                image_urls=urls_list,
                work_text=extracted_text
            )

    except Exception as e:
        print(f"🚨 AI 核心服务报错: {e}")
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {e}")

    # ==========================================
    # 5. 后置账单处理：扣费与状态持久化 (完整保留)
    # ==========================================
    try:
        metadata["last_active_date"] = today_str
        if used_pro_daily:
            metadata["pro_daily_used"] = pro_daily_used + 1
        
        if role != "pro":
            if used_pro_quota:
                metadata[f"{task}_pro"] = pro_left - 1
            else:
                metadata["flash_left"] = flash_left - 1
                
        # 写回 Supabase 用户元数据
        supabase_admin.auth.admin.update_user_by_id(
            user.id, 
            attributes={'user_metadata': metadata}
        )
    except Exception as e:
        print(f"⚠️ 数据库额度更新失败 (非致命错误): {e}")
   
    return {"report": report}
