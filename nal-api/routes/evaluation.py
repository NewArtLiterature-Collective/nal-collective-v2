# nal-api/routes/evaluation.py
from fastapi import APIRouter, Request, HTTPException, Header, Form, File, UploadFile
from typing import Optional
import io
import json
from docx import Document
from datetime import datetime, timezone, date

from services.user_service import supabase_admin
from services.literary_llm_service import LiteraryLLMService
from services.vision_llm_service import VisionLLMService

router = APIRouter()

# 模型名称常量
FLASH_MODEL = "gemini-2.5-flash"
PRO_MODEL_DAILY = "gemini-3.1-pro-preview"   # Pro 用户每日配额内使用
PRO_MODEL_CREDIT = "gemini-2.5-pro"          # pro_credits 加油包使用


@router.post("/process")
async def process_evaluation(
    request: Request,
    authorization: str = Header(None),
    task_type: str = Form(...),
    user_role: str = Form(...),
    work_text: str = Form(""),
    image_type: str = Form(""),
    image_urls: str = Form("[]"),
    ai_declaration: str = Form(""),        # 🆕 "no" = 纯人类原创 / "yes" = 已使用 AI
    has_pro_limit: str = Form("false"),
    file: UploadFile = File(None)
):
    # ==========================================
    # 1. 身份验证与权限校验
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
    except Exception:
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

    if not extracted_text.strip() and task_type not in ("picturebook", "illustration"):
        raise HTTPException(status_code=400, detail="提交的文本内容为空。")

    # 视觉赛道：AI 声明必须有值
    if task_type in ("picturebook", "illustration") and ai_declaration not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="请先完成 AI 辅助创作声明。")

    # ==========================================
    # 3. 商业路由：到期清算与模型分配
    # ==========================================
    role = metadata.get("role")
    now = datetime.now(timezone.utc)
    expiry_date_str = metadata.get("expiry_date")

    if role == "pro" and expiry_date_str:
        expiry_date = datetime.fromisoformat(expiry_date_str.replace("Z", "+00:00"))
        if expiry_date.tzinfo is None:
            expiry_date = expiry_date.replace(tzinfo=timezone.utc)
        if now > expiry_date:
            print(f"⏰ 用户 {user.id} 专业版已到期，执行降级清算。")
            role = None
            metadata["role"] = None
            metadata["is_paid"] = False
            metadata["expiry_date"] = None
            metadata["pro_credits"] = 0
            metadata["flash_left"] = 3
            supabase_admin.auth.admin.update_user_by_id(user.id, attributes={'user_metadata': metadata})

    flash_left = metadata.get("flash_left", 0)
    pro_credits = metadata.get("pro_credits", 0)

    today_str = date.today().isoformat()
    last_active = metadata.get("last_active_date", "")
    pro_daily_used = metadata.get("pro_daily_used", 0)
    if last_active != today_str:
        pro_daily_used = 0

    # 决定使用的模型与是否走 Pro 两次调用
    target_model = FLASH_MODEL
    use_pro_vision = False      # 视觉赛道是否走 Pro 两次调用
    used_flash = False
    used_pro = False
    used_pro_daily = False

    if role == "pro":
        if pro_daily_used < 5:
            target_model = PRO_MODEL_DAILY
            used_pro_daily = True
            use_pro_vision = True
        else:
            target_model = FLASH_MODEL
    else:
        if pro_credits > 0:
            target_model = PRO_MODEL_CREDIT
            used_pro = True
            use_pro_vision = True
        elif flash_left > 0:
            target_model = FLASH_MODEL
            used_flash = True
        else:
            raise HTTPException(status_code=403, detail="资源已耗尽，请购买加油包或报名参赛。")

    # ==========================================
    # 4. 动态读取模型配置（文字赛道）
    # ==========================================
    selected_model_name = "全景综合-通用基准模型"
    if task_type == "text":
        selected_model_name = "NAL-首席专家锐评模型"

    try:
        model_setting_res = supabase_admin.table("evaluation_models") \
            .select("parameters, system_instruction") \
            .eq("name", selected_model_name) \
            .single().execute()

        if model_setting_res.data:
            base_weights = model_setting_res.data.get("parameters", {})
            model_system_instruction = model_setting_res.data.get("system_instruction", "")
        else:
            base_weights = {"心理契合": 25, "文学质感": 25, "时代立意": 25, "逻辑与创新": 25}
            model_system_instruction = "你是一位高水平儿童文学评论家。"
    except Exception as e:
        print(f"⚠️ 读取云端模型维度失败，启动学术维度兜底: {e}")
        base_weights = {"心理契合": 25, "文学质感": 25, "时代立意": 25, "逻辑与创新": 25}
        model_system_instruction = "你是一位高水平儿童文学评论家。"

    # ==========================================
    # 5. 调用 AI 核心
    # ==========================================
    report = ""
    ai_declaration_violated = False   # 标记是否因 AI 声明违规终止（不扣费）
    content_violated = False          # 标记是否因内容违规终止（不扣费）

    try:
        if task_type == "guide":
            if role == "pro":
                snippet_rule = "在大纲之后，请务必提供大约 800 字的高深文学性高光片段试写。"
            elif role == "contestant" or has_pro_limit == "true":
                snippet_rule = "在大纲之后，请提供大约 300 字的高光片段试写。"
            else:
                snippet_rule = "本次指导仅提供结构性创作大纲，严禁输出任何具体的试写片段内容。"

            report = await LiteraryLLMService.generate_creative_guide(
                user_prompt=extracted_text,
                mentor_desc="资深的儿童文学策展人与创作导师风格",
                focus_dimensions="、".join(base_weights.keys()),
                snippet_rule=snippet_rule,
                target_model=target_model
            )

        elif task_type == "text":
            report = await LiteraryLLMService.evaluate_work(
                raw_text=extracted_text,
                selected_model=selected_model_name,
                base_weights=base_weights,
                model_system_instruction=model_system_instruction,
                user_note="请重点关注文本的原创性与叙事深度",
                target_model=target_model
            )

        elif task_type in ("picturebook", "illustration"):
            try:
                urls_list = json.loads(image_urls)
            except Exception:
                urls_list = []

            has_declared_ai = (ai_declaration == "yes")

            # 🆕 视觉赛道统一走新版 VisionLLMService
            # AI 声明核验 + 内容安全审查均在服务内部执行，422 时不扣费
            report = await VisionLLMService.evaluate_visual_work(
                flash_model=FLASH_MODEL,
                pro_model=target_model,        # Pro 用户时为 PRO_MODEL_DAILY / PRO_MODEL_CREDIT
                image_type=task_type,          # "picturebook" 或 "illustration"
                image_urls=urls_list,
                work_text=extracted_text,
                has_declared_ai=has_declared_ai,
                use_pro=use_pro_vision
            )

    except HTTPException as e:
        # 422 = AI 声明违规 或 内容违规，不扣费，直接透传
        if e.status_code == 422:
            return {
                "report": e.detail,
                "sync_usage": {
                    "role": metadata.get("role"),
                    "flash_left": metadata.get("flash_left", 0),
                    "pro_credits": metadata.get("pro_credits", 0)
                }
            }
        raise
    except Exception as e:
        print(f"🚨 AI 核心服务报错: {e}")
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {e}")

    # ==========================================
    # 6. 后置账单处理：扣费与状态持久化
    # ==========================================
    try:
        metadata["last_active_date"] = today_str
        if used_pro_daily:
            metadata["pro_daily_used"] = pro_daily_used + 1
        if role != "pro":
            if used_pro:
                metadata["pro_credits"] = max(0, pro_credits - 1)
            elif used_flash:
                metadata["flash_left"] = max(0, flash_left - 1)

        supabase_admin.auth.admin.update_user_by_id(user.id, attributes={'user_metadata': metadata})
    except Exception as e:
        print(f"⚠️ 数据库额度更新失败: {e}")

    return {
        "report": report,
        "sync_usage": {
            "role": metadata.get("role"),
            "flash_left": metadata.get("flash_left", 0),
            "pro_credits": metadata.get("pro_credits", 0)
        }
    }
