from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse  # 🚨 必须导入这个
from services.payment_service import PaymentService
from services.user_service import UserService
import stripe
import os

# 初始化 Router
router = APIRouter()

# 接收前端支付请求的路由
@router.post("/create-session")
async def create_checkout_session_route(request: Request):
    try:
        data = await request.json()
        user_id = data.get('user_id')
        user_email = data.get('user_email')
        # 统一使用 'plan'，对应前端传来的 'addon' 或 'contestant'
        plan = data.get('plan', 'contestant') 

        if not user_id:
            raise ValueError("缺少 user_id 参数")

        # 🚨 核心逻辑：加油包 (addon) 购买门槛检查
        if plan == "addon":
            # 获取用户当前数据
            user_data = UserService.get_user_by_id(user_id)
            
            # 安全提取元数据 (适配 Supabase Auth Admin API 的返回结构)
            meta = {}
            if user_data and hasattr(user_data, 'user'):
                meta = user_data.user.user_metadata or {}
            elif isinstance(user_data, dict):
                meta = user_data.get('user_metadata', {})

            # 统计剩余的高级资源次数 (guide, text, illustration)
            # 使用 .get(..., 0) 确保字段缺失时按 0 计算
            remaining_credits = (
                (meta.get("guide_pro") or 0) +
                (meta.get("text_pro") or 0) +
                (meta.get("illustration_pro") or 0)
            )
            
            # 如果还有剩余资源，直接拦截
            if remaining_credits > 0:
                print(f"🚫 拦截购买：用户 {user_id} 尚有 {remaining_credits} 次资源")
                return JSONResponse(
                    status_code=400,
                    content={"detail": f"您还有 {remaining_credits} 次高级额度未用完，请耗尽后再购买。"}
                )
        
        # 校验通过，调用 Service 创建 Stripe 会话
        url = PaymentService.create_checkout_session(user_id, user_email, plan)
        return {"url": url}

    except Exception as e:
        print(f"❌ 创建支付会话失败: {str(e)}")
        # 注意：这里如果不是手动返回的 JSONResponse，统一抛出 HTTPException
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, os.getenv("STRIPE_WEBHOOK_SECRET")
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Webhook 签名验证失败: {e}")

    if event['type'] == 'checkout.session.completed':
        try:
            session = event['data']['object']
            
            # 🚨 建议：统一使用字典方式获取，更稳健
            metadata = session.get('metadata', {})
            user_id = metadata.get('user_id')
            plan = metadata.get('plan', 'contestant') 
            
            print(f"🔍 Webhook 提取：User ID: {user_id}, 购买类别: {plan}")

            if user_id:
                # 呼叫 UserService：
                # 此时 UserService 里的 logic 应该是：如果是 addon，只加资源，不改 role
                UserService.upgrade_user_to_pro(user_id, plan)
                print(f"✅ Webhook 处理成功：用户 {user_id} 订单 ({plan}) 已同步")
            else:
                print("⚠️ Webhook 警告：Metadata 中未找到 user_id")

        except Exception as inner_err:
            import traceback
            print(f"❌ 处理 Webhook 时崩溃:\n{traceback.format_exc()}")
            return JSONResponse(status_code=500, content={"message": "Internal Server Error"})
            
    return {"status": "success"}
