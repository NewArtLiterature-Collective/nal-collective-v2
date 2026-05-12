from fastapi import APIRouter, Request, HTTPException, Header, Form, File, UploadFile
from typing import Optional
import os
import io
import json
import datetime
from docx import Document  # pip install python-docx

from services.user_service import UserService
from services.llm_service import generate_ai_report 

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
    file: UploadFile = File(None)  # 接收前端的 Docx 文件
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少身份验证")
    
    token = authorization.split(" ")[1]

    # 🚨 修复 1：必须先用 token 获取用户信息，才能提取 metadata
    try:
        from services.user_service import supabase_admin
        user_res = supabase_admin.auth.get_user(token)
        if not user_res or not user_res.user:
            raise Exception("会话无效")
        user = user_res.user
        metadata = user.user_metadata or {}
    except Exception as e:
        raise HTTPException(status_code=401, detail="身份验证失败，请重新登录")

    # 1. 解析 Word 文档 (仅针对文字评审)
    extracted_text = work_text
    if task_type == "text" and file and file.filename.endswith('.docx'):
        try:
            content = await file.read()
            doc = Document(io.BytesIO(content))
            extracted_text = "\n".join([p.text for p in doc.paragraphs])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"解析 Word 文档失败: {e}")

    # 🚨 修复 2：因为使用了 Form 接收参数，所以不能用 payload.task_type
    task = task_type
    role = metadata.get("role", "free")
    flash_left = metadata.get("flash_left", 5)
    pro_left = metadata.get(f"{task}_pro", 0)
    
    # 获取今天的日期字符串 (YYYY-MM-DD)
    today_str = datetime.date.today().isoformat()
    last_active = metadata.get("last_active_date", "")
    pro_daily_used = metadata.get("pro_daily_used", 0)

    # 如果跨天了，重置 Pro 用户的今日消耗
    if last_active != today_str:
        pro_daily_used = 0

    # 决定最终使用的模型
    target_model = "gemini-2.5-flash" # 默认兜底
    used_pro_quota = False            # 是否消耗了参赛选手的单次买断额度
    used_pro_daily = False            # 是否消耗了 Pro 用户的每日 3.1 额度
    
    if role == "pro":
        if pro_daily_used < 10:
            target_model = "gemini-3.1-pro-preview"
            used_pro_daily = True
        else:
            target_model = "gemini-2.5-flash" # Pro 超出10次自动降级
    elif role == "contestant" and pro_left > 0:
        target_model = "gemini-2.5-pro" # 参赛选手使用 2.5 Pro
        used_pro_quota = True
    elif flash_left > 0:
        target_model = "gemini-2.5-flash"
    else:
        raise HTTPException(status_code=403, detail="额度已耗尽，请充值。")

    # 🚨 修复 3：补全调用 AI 的代码，否则 report 变量不存在
    system_prompt = build_system_prompt(task_type, user_role, has_pro_limit, image_type)
    try:
        urls_list = json.loads(image_urls)
        report = await generate_ai_report(
            model=target_model,
            system_prompt=system_prompt,
            user_text=extracted_text,
            image_urls=urls_list
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {e}")

    # 5. 扣费与状态更新
    try:
        # 实时更新用户的用量与活跃日期
        metadata["last_active_date"] = today_str
        if used_pro_daily:
            metadata["pro_daily_used"] = pro_daily_used + 1
        
        if role != "pro":
            if used_pro_quota:
                metadata[f"{task}_pro"] = pro_left - 1
            else:
                metadata["flash_left"] = flash_left - 1
                
        # 写回数据库
        supabase_admin.auth.admin.update_user_by_id(
            user.id, 
            attributes={'user_metadata': metadata}
        )
    except Exception as e:
        print(f"⚠️ 额度/日历更新失败: {e}")
   
    return {"report": report}

def build_system_prompt(task_type: str, user_role: str, has_pro_limit: str, image_type: str) -> str:
    """不同会员层级给予不同的字数控制"""
    if task_type == "guide":
        if user_role == "pro":
            snippet_rule = "【权限特供】：在大纲之后，请务必提供大约 800 字的高深文学性高光片段试写。"
        elif user_role == "contestant" or has_pro_limit == "true":
            snippet_rule = "【参赛权益】：在大纲之后，请提供大约 300 字的高光片段试写。"
        else:
            snippet_rule = "【权限拦截】：本次指导仅提供结构性创作大纲，严禁输出任何具体的试写片段内容。"

        return f"""
        你是一位资深的儿童文学策展人与创作导师。
        请针对用户提供的创作构思提供方向性指导。
        核心原则：
        1. 鼓励极致的原创精神，警惕盲目跟风。
        2. 引导创作者发掘具有深层文学底色和本土特色的内核。
        {snippet_rule}
        """
        
    elif task_type == "text":
        return """
        你是一位严谨的儿童文学理论评论家。
        请对用户提交的 Word 文本进行深度解剖，指出刻板说教和“人造儿童”现象。
        你需要像一位严苛的评委一样输出真实的打分，以及犀利的修改建议。
        """
        
    elif task_type == "illustration":
        context = "绘本连环分镜" if image_type == "picture-book" else "单幅插画视觉"
        return f"""
        你是一位顶级的视觉艺术总监。当前评审模式：【{context}】。
        请评估画面的视觉张力与图文互文效果。
        """
    return ""