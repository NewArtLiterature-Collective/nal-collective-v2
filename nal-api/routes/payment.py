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
@router.post("/webhook")
async def stripe_webhook(request: Request):
    # 1. 绝对安全地获取 Body 和 签名头部 (规避 Header 依赖注入的潜藏 Bug)
    payload = await request.body()
    stripe_signature = request.headers.get("stripe-signature")
    
    if not stripe_signature:
        print("⚠️ Webhook 拦截：Stripe 签名头部丢失")
        return {"status": "error", "message": "Missing signature"}
        
    try:
        # 2. 验证这封“信”确实是 Stripe 寄来的
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, settings.STRIPE_WEBHOOK_SECRET
        )
        
        # 3. 判断事件类型：用户是否支付成功？
        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            
            # 绝对安全地提取 metadata，哪怕它完全是空的也不会崩溃
            metadata = session.get('metadata') or {}
            user_id = metadata.get('user_id')
            plan_type = metadata.get('plan_type', 'contestant') 
            
            if not user_id:
                print("⚠️ Webhook 警告：账单中没有 user_id，无法执行数据库充值！")
                return {"status": "ignored"}
                
            print(f"💰 Webhook 收到成功支付指令，准备发货。UserID: {user_id}, 购买类型: {plan_type}")
            
            # 执行数据库升级
            UserService.upgrade_user_to_pro(user_id, plan_type)
            print(f"✅ UserID: {user_id} 权限（{plan_type}）充值写入数据库成功！")
                
        # 必须返回 200 让 Stripe 知道你收到了
        return {"status": "success"}

    except stripe.error.SignatureVerificationError:
        print("🚨 Stripe 签名验证失败！可能是你的 STRIPE_WEBHOOK_SECRET 填错了。")
        raise HTTPException(status_code=400, detail="Invalid signature")
        
    except Exception as e:
        # 🚨 终极杀手锏：如果再崩溃，打印出完整的代码行数和报错调用栈！
        print("🚨 Webhook 出现了未知的严重崩溃，详细追踪信息如下：")
        traceback.print_exc() 
        raise HTTPException(status_code=400, detail=str(e))
