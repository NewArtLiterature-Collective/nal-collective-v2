# nal-api/routes/payment.py
import traceback  # 🚨 确保在文件顶部加上这行导入
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
# routes/payment.py
@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
        
        if event['type'] == 'checkout.session.completed':
            # 🚀 方案：强制转字典，杜绝一切 Python 3.14 的对象兼容问题
            session = event['data']['object'].to_dict() 
            
            metadata = session.get('metadata') or {}
            user_id = metadata.get('user_id')
            
            # 💡 既然你说了“支付行为就是明确的”，那我们直接从订单里看付了多少钱
            # 而不是非要依赖前端传过来的 plan_type
            amount_total = session.get('amount_total', 0) / 100  # 转为元
            
            if not user_id:
                return {"status": "ignored"}

            print(f"💰 收到支付：{amount_total}元，UserID: {user_id}")

            # 🚀 核心逻辑交给 UserService，它会根据“钱”和“人”来判断
            UserService.handle_payment_fulfillment(user_id, amount_total)
            
            print(f"✅ 权益发放成功")

        return {"status": "success"}
    except Exception:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "webhook error"})        raise HTTPException(status_code=400, detail=str(e))
