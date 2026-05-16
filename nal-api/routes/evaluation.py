# nal-api/routes/evaluation.py
from fastapi import APIRouter, Request, HTTPException, Header, Form, File, UploadFile
from typing import Optional
import io
import json
from docx import Document
# 🚨 核心修正 1：规范化时间库引入，只引入 datetime 和 timezone，绝不发生覆盖对撞
from datetime import datetime, timezone, date 

from services.user_service import supabase_admin
from services.literary_llm_service import LiteraryLLMService
from services.vision_llm_service import VisionLLMService

router = APIRouter()

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

    # 🚨 边界防御：如果文本和文件同时为空，直接拦截，拒绝浪费核心算力
    if not extracted_text.strip() and task_type != "picturebook":
        raise HTTPException(status_code=400, detail="提交的文本内容为空，请输入文字或上传 Word 文档。")

    # ==========================================
    # 3. 商业路由：到期清算与模型分配
    # ==========================================
    role = metadata.get("role")
    
    # --- 专业版到期清算逻辑 (精准热修复版) ---
    now = datetime.now(timezone.utc)
    expiry_date_str = metadata.get("expiry_date")
    
    if role == "pro" and expiry_date_str:
        # 🚨 核心修正 2：使用更正后的类名 datetime.fromisoformat，并添加 Z 兼容垫片
        expiry_date = datetime.fromisoformat(expiry_date_str.replace("Z", "+00:00"))
        
        # 🚨 核心修正 3：防止缺少时区指纹，强制上锁 UTC
        if expiry_date.tzinfo is None:
            expiry_date = expiry_date.replace(tzinfo=timezone.utc)
            
        if now > expiry_date:
            print(f"⏰ 用户 {user.id} 专业版已到期，执行降级清算。")
            role = None  # 内部路由身份状态退化
            metadata["role"] = None
            metadata["is_paid"] = False
            metadata["expiry_date"] = None
            metadata["pro_credits"] = 0
            metadata["flash_left"] = 5  # 重新分配为普通用户的 5 次初始资源
            # 立即写回数据库，防止并发漏洞
            supabase_admin.auth.admin.update_user_by_id(user.id, attributes={'user_metadata': metadata})

    # 读取当前最新额度
    flash_left = metadata.get("flash_left", 0)
    pro_credits = metadata.get("pro_credits", 0) 
    
    today_str = date.today().isoformat()  # 👈 联动修正：使用标准的 date.today()
    last_active = metadata.get("last_active_date", "")
    pro_daily_used = metadata.get("pro_daily_used", 0)

    # 跨天重置 Pro 每日用量
    if last_active != today_str:
        pro_daily_used = 0

    # 路由追踪变量
    target_model = "gemini-2.5-flash" 
    used_flash = False
    used_pro = False
    used_pro_daily = False 
    
    # --- 核心分配逻辑 ---
    if role == "pro":
        if pro_daily_used < 5: 
            target_model = "gemini-3.1-pro-preview" 
            used_pro_daily = True
        else:
            target_model = "gemini-2.5-flash"
    else:
        # 瀑布流扣费预检
        if flash_left > 0:
            target_model = "gemini-2.5-flash"
            used_flash = True
        elif pro_credits > 0:
            target_model = "gemini-2.5-pro" 
            used_pro = True
        else:
            raise HTTPException(status_code=403, detail="资源已耗尽，请购买加油包或报名参赛。")

    # ==========================================
    # 4. 调用 AI 核心 (完美契合专家提示词改进版)
    # ==========================================
    report = ""
    try:
        if task_type == "guide":
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

        elif task_type == "text":
            report = await LiteraryLLMService.evaluate_work(
                raw_text=extracted_text,
                selected_model="NAL-首席专家锐评模型",
                base_weights={"fantasy": 25, "reality": 30, "character": 45}, 
                model_system_instruction="你是一位严谨的儿童文学理论评论家。请指出刻板说教和“人造儿童”现象。",
                user_note="请重点关注文本的原创性与叙事深度",
                target_model=target_model
            )
            
        elif task_type == "picturebook":
            try:
                urls_list = json.loads(image_urls)
            except:
                urls_list = []
            
            report = await VisionLLMService.evaluate_visual_work(
                target_model=target_model,
                image_type=image_type,
                image_urls=urls_list,
                work_text=extracted_text
            )

    except Exception as e:
        print(f"🚨 AI 核心服务报错: {e}")
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {e}")

    # ==========================================
    # 5. 后置账单处理：扣费与状态持久化
    # ==========================================
    try:
        metadata["last_active_date"] = today_str
        
        if used_pro_daily:
            metadata["pro_daily_used"] = pro_daily_used + 1
        
        if role != "pro":
            if used_flash:
                metadata["flash_left"] = max(0, flash_left - 1)
                print(f"💰 用户 {user.id} 扣费成功：消耗 1 次 Flash")
            elif used_pro:
                metadata["pro_credits"] = max(0, pro_credits - 1)
                print(f"💰 用户 {user.id} 扣费成功：消耗 1 次 Pro (Flash已耗尽)")
                
        # 写回 Supabase 用户元数据
        supabase_admin.auth.admin.update_user_by_id(
            user.id, 
            attributes={'user_metadata': metadata}
        )
    except Exception as e:
        print(f"⚠️ 数据库额度更新失败 (非致命错误): {e}")
   
    # 🚨 高阶体验重构：在返回报告的同时，将最新扣减后的资产余量同步发回给前端，实现即时渲染！
    return {
        "report": report,
        "sync_usage": {
            "role": metadata.get("role"),
            "flash_left": metadata.get("flash_left", 0),
            "pro_credits": metadata.get("pro_credits", 0)
        }
    }
