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

        if not user_id:
            raise ValueError("缺少 user_id 参数")

        # 🚨 拦截逻辑增强版
        if plan == "addon":
            print(f"🛠️ 正在检查用户 {user_id} 的余额...")
            user_res = UserService.get_user_by_id(user_id)
            
            # 兼容性提取 Meta
            meta = {}
            if user_res:
                # 尝试从不同层级提取元数据
                if hasattr(user_res, 'user') and user_res.user:
                    meta = user_res.user.user_metadata or {}
                elif isinstance(user_res, dict):
                    meta = user_res.get('user_metadata', {})
            
            print(f"📊 当前用户元数据摘要: {list(meta.keys())}") # 调试用

            # 统计资源
            r1 = int(meta.get("guide_pro") or 0)
            r2 = int(meta.get("text_pro") or 0)
            r3 = int(meta.get("illustration_pro") or 0)
            remaining = r1 + r2 + r3
            
            print(f"💎 剩余资源统计: Guide:{r1}, Text:{r2}, Illus:{r3}, Total:{remaining}")

            if remaining > 0:
                print(f"🚫 拦截成功：资源未耗尽")
                return JSONResponse(
                    status_code=400,
                    content={"detail": f"您还有 {remaining} 次高级额度，请用完再买。"}
                )

        url = PaymentService.create_checkout_session(user_id, user_email, plan)
        return {"url": url}

    except Exception as e:
        print(f"❌ 支付会话异常: {str(e)}")
        return JSONResponse(status_code=500, content={"detail": str(e)})


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
