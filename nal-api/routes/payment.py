from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from services.payment_service import PaymentService
from services.user_service import UserService
import stripe
import os

router = APIRouter()

@router.post("/create-session")
async def create_checkout_session_route(request: Request):
    try:
        data = await request.json()
        user_id = data.get('user_id')
        user_email = data.get('user_email')
        plan = data.get('plan', 'contestant') 

        # 🚨 核心逻辑：加油包 (addon) 购买门槛检查
        if plan == "addon":
            user_res = UserService.get_user_by_id(user_id)
            meta = {}
            if user_res and hasattr(user_res, 'user'):
                meta = user_res.user.user_metadata or {}
            
            # 1. 如果是 Pro，不执行拦截逻辑（因为前端已隐藏按钮，这里做后台保底）
            if meta.get("role") == "pro":
                return {"url": PaymentService.create_checkout_session(user_id, user_email, plan)}

            # 2. 资源耗尽检查：基础 Flash (注册默认 5 次) + 三项高级资源
            f0 = int(meta.get("flash_left", 5)) # 默认为 5，因为注册即送
            r1 = int(meta.get("guide_pro") or 0)
            r2 = int(meta.get("text_pro") or 0)
            r3 = int(meta.get("illustration_pro") or 0)
            
            total = f0 + r1 + r2 + r3
            
            # 只要还有资源，就不允许进入支付页面
            if total > 0:
                return JSONResponse(
                    status_code=400,
                    content={"detail": f"您还有 {total} 次资源未用完，请耗尽后再购买加油包。"}
                )

        # 正常创建支付链接
        url = PaymentService.create_checkout_session(user_id, user_email, plan)
        return {"url": url}
    except Exception as e:
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
        return JSONResponse(status_code=400, content={"message": str(e)})

    if event['type'] == 'checkout.session.completed':
        try:
            # 🚨 修复关键：将 Stripe 对象转为标准字典
            session_obj = event['data']['object']
            # 使用 getattr 获取 metadata 对象，或者直接转成 dict
            session_dict = session_obj.to_dict() 
            
            metadata = session_dict.get('metadata', {})
            user_id = metadata.get('user_id')
            plan = metadata.get('plan', 'contestant')
            
            print(f"💰 Webhook 成功解析：User:{user_id}, Plan:{plan}")

            if user_id:
                UserService.upgrade_user_to_pro(user_id, plan)
        
        except Exception as err:
            import traceback
            traceback.print_exc()
            return JSONResponse(status_code=500, content={"message": "Internal Error"})
            
    return {"status": "success"}
