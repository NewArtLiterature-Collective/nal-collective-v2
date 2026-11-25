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

# 模型名称常量（2026-11 迁移：2.5 系列 12-01 停用；2026-11-23 主编确认 3.8 Flash 换为 Gemini 4 Hydrogen）
# 写法 "模型名@思考档位"，由 literary/vision 服务的 resolve_model() 解析
FLASH_MODEL = "gemini-4-hydrogen@low"          # 免费额度 / 初读（原 gemini-3.8-flash@low）
PRO_MODEL_DAILY = "gemini-4-hydrogen@medium"   # Pro 用户每日配额内使用（原 gemini-3.1-pro-preview 已下线；2026-11-25 考虑费用定为 Hydrogen 中思考档）
PRO_MODEL_CREDIT = "gemini-4-hydrogen@medium"  # pro_credits 加油包使用（原 gemini-3.8-flash@medium）


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
    page_format: str = Form("single"),     # 📐 "single" 单页 / "spread" 跨页合图（绘本专属）
    has_pro_limit: str = Form("false"),
    model_db_id: str = Form(""),           # 用户在工作台选定的专家（evaluation_models.id）；绘本插画不传
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
        app_meta = user.app_metadata or {}   # 🔒 role 权威来源（仅 service_role 可写）
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

    # 视觉赛道与文字赛道：AI 声明必须有值（创作指导 guide 不需要）
    if task_type in ("picturebook", "illustration", "text") and ai_declaration not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="请先完成 AI 辅助创作声明。")

    # ==========================================
    # 3. 商业路由：到期清算与模型分配
    # ==========================================
    # 🔒 权益（role / 额度 / 到期 / 每日计数）全部存 app_metadata，用户不可改
    role = app_meta.get("role")
    now = datetime.now(timezone.utc)
    expiry_date_str = app_meta.get("expiry_date")

    if role == "pro" and expiry_date_str:
        expiry_date = datetime.fromisoformat(expiry_date_str.replace("Z", "+00:00"))
        if expiry_date.tzinfo is None:
            expiry_date = expiry_date.replace(tzinfo=timezone.utc)
        if now > expiry_date:
            print(f"⏰ 用户 {user.id} 专业版已到期，执行降级清算。")
            role = "free"
            app_meta["role"] = "free"
            app_meta["expiry_date"] = None
            app_meta["pro_credits"] = 0
            app_meta["flash_left"] = 3
            app_meta.pop("is_paid", None)
            supabase_admin.auth.admin.update_user_by_id(user.id, attributes={'app_metadata': app_meta})

    flash_left = app_meta.get("flash_left", 3)   # 新用户缺省 3 次免费额度
    pro_credits = app_meta.get("pro_credits", 0)

    today_str = date.today().isoformat()
    last_active = app_meta.get("last_active_date", "")
    pro_daily_used = app_meta.get("pro_daily_used", 0)
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
    # 4. 读取用户指定的专家（文字评审 / 创作指导）
    #    2026-11-24：按用户在工作台选定的专家评审（此前前端传了 model_db_id，后端未读取，
    #    文字评审固定用"首席专家锐评"）。非 Pro 用户只能用"全景综合""首席专家"两位（与前端一致）；
    #    未指定、无权使用或读取失败时，回落到"首席专家锐评"。
    # ==========================================
    DEFAULT_EXPERT = "NAL-首席专家锐评模型"
    FALLBACK_WEIGHTS = {"心理契合": 25, "文学质感": 25, "时代立意": 25, "逻辑与创新": 25}
    FALLBACK_INSTRUCTION = "你是一位高水平儿童文学评论家。"

    def _expert_allowed(name: str) -> bool:
        return role == "pro" or ("全景综合" in (name or "")) or ("首席专家" in (name or ""))

    expert = None
    try:
        if model_db_id and task_type in ("text", "guide"):
            r = supabase_admin.table("evaluation_models") \
                .select("id, name, parameters, system_instruction") \
                .eq("id", model_db_id).limit(1).execute()
            row = (r.data or [None])[0]
            if row and _expert_allowed(row.get("name")):
                expert = row
            elif row:
                print(f"⚠️ 用户 {user.id} 无权使用专家【{row.get('name')}】，改用默认专家")
        if expert is None:
            r = supabase_admin.table("evaluation_models") \
                .select("id, name, parameters, system_instruction") \
                .eq("name", DEFAULT_EXPERT).limit(1).execute()
            expert = (r.data or [None])[0]
    except Exception as e:
        print(f"⚠️ 读取专家配置失败，启用兜底维度: {e}")
        expert = None

    selected_model_name = (expert or {}).get("name") or DEFAULT_EXPERT
    base_weights = (expert or {}).get("parameters") or FALLBACK_WEIGHTS
    model_system_instruction = (expert or {}).get("system_instruction") or FALLBACK_INSTRUCTION

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
            # 🆕 文字赛道：传入 AI 声明状态，服务内部执行声明核验
            # 未声明却查出确凿 AI 痕迹时，服务抛 422，下方统一不扣费透传
            has_declared_ai = (ai_declaration == "yes")
            report = await LiteraryLLMService.evaluate_work(
                raw_text=extracted_text,
                selected_model=selected_model_name,
                base_weights=base_weights,
                model_system_instruction=model_system_instruction,
                user_note="请重点关注文本的原创性与叙事深度",
                target_model=target_model,
                has_declared_ai=has_declared_ai
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
                pro_model=target_model,
                image_type=task_type,
                image_urls=urls_list,
                work_text=extracted_text,
                has_declared_ai=has_declared_ai,
                use_pro=use_pro_vision,
                page_format=page_format if task_type == "picturebook" else "single"
            )

    except HTTPException as e:
        # 422 = AI 声明违规 或 内容违规，不扣费，直接透传
        if e.status_code == 422:
            return {
                "report": e.detail,
                "sync_usage": {
                    "role": app_meta.get("role"),
                    "flash_left": app_meta.get("flash_left", 3),
                    "pro_credits": app_meta.get("pro_credits", 0),
                    "pro_eval_count": app_meta.get("pro_eval_count", 0)
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
        # 🔒 扣费与状态持久化全部写 app_metadata（权益权威来源）
        app_meta["last_active_date"] = today_str
        if used_pro_daily:
            app_meta["pro_daily_used"] = pro_daily_used + 1
        if role == "pro":
            # 📊 Pro 使用计数（退款资格核验与前端显示；只有成功的评审才计数，422 被拦下的不计）
            app_meta["pro_eval_count"] = int(app_meta.get("pro_eval_count") or 0) + 1
        if role != "pro":
            if used_pro:
                app_meta["pro_credits"] = max(0, pro_credits - 1)
            elif used_flash:
                app_meta["flash_left"] = max(0, flash_left - 1)

        supabase_admin.auth.admin.update_user_by_id(user.id, attributes={'app_metadata': app_meta})
    except Exception as e:
        print(f"⚠️ 数据库额度更新失败: {e}")

    return {
        "report": report,
        "sync_usage": {
            "role": app_meta.get("role"),
            "flash_left": app_meta.get("flash_left", 3),
            "pro_credits": app_meta.get("pro_credits", 0),
            "pro_eval_count": app_meta.get("pro_eval_count", 0)
        }
    }
