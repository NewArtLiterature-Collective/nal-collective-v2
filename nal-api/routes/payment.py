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
        plan_type = body.get("plan_type") # 👈 前端需要把用户买的是什么传过来 (booster / pro / contestant)
        
        if not user_id or not plan_type:
            raise HTTPException(status_code=400, detail="Missing user_id or plan_type")
            
       # 把 plan_type 也传给你的服务
        checkout_url = PaymentService.create_checkout_session(user_id, user_email, plan_type)
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
            
            try:
                # 🚨 核心修改：不仅要拿 user_id，还要拿 plan_type
                user_id = session['metadata']['user_id']
                # 获取计划类型，如果万一没传，兜底认为是 'contestant'
                plan_type = session['metadata'].get('plan_type', 'contestant') 
                
                print(f"💰 Webhook 收到成功支付指令，UserID: {user_id}, 购买类型: {plan_type}")
                
                # 🚨 将两个参数一起传给我们的 UserService
                UserService.upgrade_user_to_pro(user_id, plan_type)
                print(f"✅ UserID: {user_id} 权限（{plan_type}）升级成功")
                
            except KeyError:
                print("⚠️ Webhook 错误：Metadata 中缺少字段，无法更新数据库")
                
        # 必须返回 200/success 让 Stripe 知道你收到了，否则它会一直重发
        return {"status": "success"}
        
    except stripe.error.SignatureVerificationError as e:
        print("🚨 Webhook 签名验证失败！可能是 SECRET 不对。")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        print(f"🚨 Webhook 内部处理崩溃: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
