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
            
            # 1. 如果是 Pro 会员，直接保底放行（无限额度用户前端已隐藏按钮）
            if meta.get("role") == "pro":
                return {"url": PaymentService.create_checkout_session(user_id, user_email, plan)}

            # 2. 🚨 核心修正：完全废弃旧的细分字段，精准对齐统一额度账本 (新用户默认3次)
            f0 = int(meta.get("flash_left") if meta.get("flash_left") is not None else 3)
            pro_credits = int(meta.get("pro_credits") or 0) # 👈 统一读取 Pro 点数
            
            total = f0 + pro_credits
            
            # 只要还有任何剩余资源，就不允许进入支付页面
            if total > 0:
                return JSONResponse(
                    status_code=400,
                    content={"detail": f"您还有 {total} 次可用资源（含高级额度），请耗尽后再购买资源加油包。"}
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
            # 将 Stripe 对象转为标准字典
            session_obj = event['data']['object']
            session_dict = session_obj.to_dict() 

            if session_dict.get('payment_status') != 'paid':
                return {"status": "skipped"}
            
            metadata = session_dict.get('metadata', {})
            user_id = metadata.get('user_id')
            plan = metadata.get('plan', 'contestant')
            # 兼容多赛季扩展，可以从 metadata 里传，或者使用默认值
            contest_id = metadata.get('contest_id', '2026_contest') 
            
            print(f"💰 Webhook 成功解析：User:{user_id}, Plan:{plan}")

            if user_id:
                if plan == 'contestant':
                    # =======================================================
                    # 🚨 参赛资格门票：动态精算与发货逻辑
                    # =======================================================
                    user_res = UserService.get_user_by_id(user_id)
                    current_meta = {}
                    if user_res and hasattr(user_res, 'user'):
                        current_meta = user_res.user.user_metadata or {}

                    current_flash = int(current_meta.get("flash_left") if current_meta.get("flash_left") is not None else 3)
                    current_pro = int(current_meta.get("pro_credits") or 0)

                    # 1. 继承原有数据，并升级为参赛者身份
                    new_meta = current_meta.copy()
                    new_meta['role'] = 'contestant'
                    new_meta['paid_contest_id'] = contest_id

                    # 2. 执行严密的商业叠加规则
                    if current_flash > 0 or current_pro > 0:
                        # 资源未用完的情况：Flash 不变，叠加 1 次 Pro
                        new_meta['flash_left'] = current_flash
                        new_meta['pro_credits'] = current_pro + 1
                    else:
                        # 资源已用完的情况 (枯竭状态)：获得 1 次 Flash 和 1 次 Pro
                        new_meta['flash_left'] = 1
                        new_meta['pro_credits'] = 1

                    print(f"🎯 门票发货精算完毕: Flash({current_flash} -> {new_meta['flash_left']}), Pro({current_pro} -> {new_meta['pro_credits']})")

                    # 3. 强力保存
                    # 要求 UserService 拥有一个能够直接保存字典数据的通用方法
                    UserService.update_user_metadata(user_id, new_meta)
                    
                else:
                    # =======================================================
                    # 其他商品 (addon / pro)：继续走原有升级流水线
                    # =======================================================
                    UserService.upgrade_user_to_pro(user_id, plan)
        
        except Exception as err:
            import traceback
            traceback.print_exc()
            return JSONResponse(status_code=500, content={"message": "Internal Error"})
            
    return {"status": "success"}
