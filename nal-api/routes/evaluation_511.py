import os
from fastapi import APIRouter, Request, HTTPException, Header
from supabase import create_client, Client
from dotenv import load_dotenv
from services.pb_review_service import PBReviewService

# 加载 .env 配置文件
load_dotenv()

router = APIRouter(prefix="/api/v1/evaluate", tags=["Evaluation"])

# 🚨 从环境变量安全读取配置
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("⚠️ 警告: .env 中缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，计费功能将失效。")

# 使用 Service Role 权限初始化超级管理员客户端，用于绕过 RLS 扣除额度
supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

@router.post("/process")
async def process_evaluation(request: Request, authorization: str = Header(None)):
    """
    评审统一分发路由：包含权限校验、额度预检、执行评审、扣除额度四个阶段。
    """
    # 1. 身份验证
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization token.")
    
    token = authorization.split("Bearer ")[1]
    
    try:
        # 使用 Admin 权限验证 Token 并获取最新的用户信息
        user_res = supabase_admin.auth.get_user(token)
        user = user_res.user
        if not user:
            raise Exception("User not found.")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

    # 解析请求体
    body = await request.json()
    task_type = body.get("task_type") # 'text', 'illustration', 'guide'
    work_text = body.get("work_text", "")
    
    # 获取用户元数据
    user_meta = user.user_metadata or {}
    user_role = user_meta.get("role", "free")
    # 兼容历史逻辑：如果标记了 is_paid 则视为参赛选手
    if user_meta.get("is_paid"):
        user_role = "contestant"
        
    is_pro = (user_role == "pro")
    
    # 2. 额度预检逻辑
    flash_left = user_meta.get("flash_left", 4)
    pro_quota_key = f"{task_type}_pro"
    pro_left = user_meta.get(pro_quota_key, 0)

    # 确定扣费优先级：Pro 专用额度 > Flash 基础额度
    consume_type = None
    if is_pro:
        consume_type = "unlimited"
    elif pro_left > 0:
        consume_type = "pro"
    elif flash_left > 0:
        consume_type = "flash"
    else:
        raise HTTPException(status_code=402, detail="您的评审额度已耗尽，请报名参赛或升级会员。")

    # 3. 执行评审功能 (完全保留已有 pb-api.nal-ai.org 连接处理)
    try:
        if task_type == "illustration":
            image_urls = body.get("image_urls", [])
            image_type = body.get("image_type", "illustration")
            
            if not image_urls:
                raise HTTPException(status_code=400, detail="插画评审模式必须提供图片素材。")
                
            # 🚨 这里的调用逻辑与之前完全一致，不改动 PBReviewService 内部连接功能
            report_content = await PBReviewService.evaluate_visual_work(
                image_urls=image_urls,
                script_text=work_text,
                work_type=image_type
            )
        else:
            # 占位：未来接入 AIService 文本评审逻辑
            report_content = f"【NAL 文本评审】已接收您的作品。本次分析消耗了 1 次 {consume_type} 额度。"
            
    except Exception as e:
        # 如果 AI 引擎（pb-api）返回错误或超时，在此处拦截，不进入下方的扣费环节
        raise HTTPException(status_code=500, detail=f"AI 分析引擎暂不可用: {str(e)}")

    # 4. 评审成功后执行扣费 (事务闭环)
    if consume_type != "unlimited":
        new_meta = user_meta.copy()
        
        if consume_type == "pro":
            new_meta[pro_quota_key] = pro_left - 1
        elif consume_type == "flash":
            new_meta["flash_left"] = flash_left - 1
            
        # 使用 Service Role Key 更新 Auth 数据库中的用户元数据
        try:
            supabase_admin.auth.admin.update_user_by_id(
                user.id, 
                {"user_metadata": new_meta}
            )
        except Exception as e:
            # 记录日志但不拦截已经生成的报告
            print(f"⚠️ 额度扣减写入失败: {e}")

    # 返回给前端
    return {"report": report_content}