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
    payload = await request.body()
    # 强制直接从 Headers 获取，不再依赖任何复杂的注入
    sig_header = request.headers.get("stripe-signature")
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
        
        if event['type'] == 'checkout.session.completed':
            # 1. 核心：拿到原始 Session 对象
            session_obj = event['data']['object']
            
            # 2. 暴力破解：强制将整个 Stripe 对象转为标准字典
            # 这样做可以彻底杀掉 StripeObject 的魔幻行为，变成纯粹的 Python 字典
            session_dict = session_obj.to_dict()
            
            # 3. 从纯字典里拿数据（这下绝对有 .get 方法了）
            metadata = session_dict.get('metadata') or {}
            user_id = metadata.get('user_id')
            plan_type = metadata.get('plan_type', 'contestant')
            
            # 调试打印：如果这里还拿不到，说明数据根本没传进 Stripe
            print(f"🔍 调试：Session 字典内容: {session_dict}")
            
            if not user_id:
                print("⚠️ Webhook 警告：字典中缺失 user_id")
                return {"status": "ignored"}

            print(f"💰 成功识别支付！UserID: {user_id}, Plan: {plan_type}")
            
            # 执行发货
            UserService.upgrade_user_to_pro(user_id, plan_type)
            print(f"✅ 数据库写入成功")

        return {"status": "success"}

    except Exception as e:
        # 别只看报错名，打印出到底在哪一行
        import traceback
        print("🚨 Webhook 终极崩溃追踪：")
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))
    except stripe.error.SignatureVerificationError:
        print("🚨 Stripe 签名验证失败！可能是你的 STRIPE_WEBHOOK_SECRET 填错了。")
        raise HTTPException(status_code=400, detail="Invalid signature")
        
    except Exception as e:
        # 🚨 终极杀手锏：如果再崩溃，打印出完整的代码行数和报错调用栈！
        print("🚨 Webhook 出现了未知的严重崩溃，详细追踪信息如下：")
        traceback.print_exc() 
        raise HTTPException(status_code=400, detail=str(e))
