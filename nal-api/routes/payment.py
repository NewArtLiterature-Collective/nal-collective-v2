# nal-api/routes/payment.py
import stripe
from fastapi import APIRouter, Request, Header, HTTPException
from core.config import settings
from services.payment_service import PaymentService
from services.user_service import UserService

# 初始化 Router，不需要写前缀
router = APIRouter()

# --- 接口 1: 创建支付会话 ---
# 真实完整路径将会是: POST /api/v1/payment/create-session
@router.post("/create-session")
async def create_payment_session(request: Request):
    try:
        # 解析前端传来的 json 数据
        body = await request.json()
        user_id = body.get("user_id")
        user_email = body.get("user_email")
        
        if not user_id:
            raise HTTPException(status_code=400, detail="Missing user_id")
            
        checkout_url = PaymentService.create_checkout_session(user_id, user_email)
        return {"url": checkout_url}
    except Exception as e:
        print(f"🚨 创建支付会话失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# --- 接口 2: 处理 Stripe 支付成功回调 (Webhook) ---
# 真实完整路径将会是: POST /api/v1/payment/webhook
@router.post("/webhook")
async def stripe_webhook(request: Request, stripe_signature: str = Header(None)):
    # ⚠️ Webhook 必须读取 raw body (字节流) 来验证签名，不能用 json()
    payload = await request.body() 
    
    try:
        # 验证这封“信”确实是 Stripe 寄来的
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, settings.STRIPE_WEBHOOK_SECRET
        )
        
        # 判断事件类型：用户是否支付成功？
        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            
            # 从 metadata 中提取你传递的 user_id
            try:
                user_id = session['metadata']['user_id']
                print(f"💰 Webhook 收到成功支付指令，UserID: {user_id}")
                
                # 升级数据库中的用户权限
                # 注意：如果你的 upgrade_user_to_pro 被定义成了 async def，这里请加上 await
                UserService.upgrade_user_to_pro(user_id)
                print(f"✅ UserID: {user_id} 权限已升级为 Pro/参赛者")
                
            except KeyError:
                print("⚠️ Webhook 错误：Metadata 中缺少 user_id 字段，无法更新数据库")
                
        # 必须返回 200/success 让 Stripe 知道你收到了，否则它会一直重发
        return {"status": "success"}
        
    except stripe.error.SignatureVerificationError as e:
        print("🚨 Webhook 签名验证失败！可能是 SECRET 不对。")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        print(f"🚨 Webhook 内部处理崩溃: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
