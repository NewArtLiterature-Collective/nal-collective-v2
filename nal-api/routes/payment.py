from fastapi import APIRouter, Request, Header, HTTPException
from services.payment_service import PaymentService
from services.user_service import UserService
import stripe
import os

router = APIRouter(prefix="/api/v1/payment", tags=["Payment"])

# 🚨 补充：接收前端支付请求的路由
@router.post("/create-session")
async def create_checkout_session_route(request: Request):
    try:
        data = await request.json()
        user_id = data.get('user_id')
        user_email = data.get('user_email')
        plan = data.get('plan', 'contestant')  # 从前端接收是 'contestant' 还是 'addon'

        if not user_id:
            raise ValueError("缺少 user_id 参数")

        # 将 plan 传给 Service
        url = PaymentService.create_checkout_session(user_id, user_email, plan)
        return {"url": url}
    except Exception as e:
        print(f"❌ 创建支付会话失败: {str(e)}")
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
            
            metadata = getattr(session, 'metadata', None)
            
            if isinstance(metadata, dict):
                user_id = metadata.get('user_id')
                plan = metadata.get('plan', 'contestant') # 🚨 修复 3：提取商品类型
            else:
                user_id = getattr(metadata, 'user_id', None)
                plan = getattr(metadata, 'plan', 'contestant')
            
            print(f"🔍 提取到的 User ID: {user_id}, 购买类别: {plan}")

            if user_id:
                print("⏳ 准备呼叫 UserService 修改数据库...")
                # 🚨 修复 3：把 plan 传给发货部门，告诉他们该发什么货！
                UserService.upgrade_user_to_pro(user_id, plan)
                print(f"✅ Webhook 成功：用户 {user_id} 订单 ({plan}) 已处理")
            else:
                print("⚠️ Webhook 警告：订单的 Metadata 中未找到 user_id")

        except Exception as inner_err:
            import traceback
            print(f"❌ 致命错误：处理 Webhook 时崩溃:\n{traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=str(inner_err))
            
    return {"status": "success"}