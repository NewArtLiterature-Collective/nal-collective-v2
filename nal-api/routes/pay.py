from fastapi import APIRouter, Request, Header, HTTPException
from services.payment_service import PaymentService # 🚨 引入你上午写好的 Service

router = APIRouter(prefix="/api/v1/pay", tags=["Payment"])

@router.post("/create-session")
async def create_checkout_session(request: Request, authorization: str = Header(None)):
    # 1. 简单的鉴权逻辑
    # ... (省略，跟 evaluation.py 一样)
    
    body = await request.json()
    plan = body.get("plan")
    
    # 2. 🚨 直接调用你上午调试成功的 service 函数
    try:
        session_url = await PaymentService.create_stripe_session(
            user_id=user.id, 
            email=user.email, 
            plan=plan
        )
        return {"url": session_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/webhook")
async def stripe_webhook(request: Request):
    # 🚨 直接调用你上午写好的 Webhook 处理函数
    return await PaymentService.handle_webhook(request)