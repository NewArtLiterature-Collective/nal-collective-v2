import stripe
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from services.payment_service import PaymentService
from services.user_service import UserService
from routes.evaluation import router as evaluation_router
from routes import payment


app = FastAPI(title="NAL API")

# 配置 CORS，允许前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://v2.nal-ai.org"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册评审模块路由
app.include_router(evaluation_router)
@app.get("/")
def health_check():
    return {"status": "ok", "message": "NAL API Server is running"}

# 修改 main.py 这一行
app.include_router(payment.router, prefix="/api/v1/payment", tags=["Payment"])

# 初始化 Stripe
stripe.api_key = settings.STRIPE_SECRET_KEY

@app.get("/")
async def root():
    return {"message": "NAL API is running"}

# --- 支付接口：创建 Checkout Session ---
@app.post("/api/v1/payment/create-session")
async def create_payment_session(request: Request):
    try:
        # 🚨 解析前端传来的 json 数据
        body = await request.json()
        user_id = body.get("user_id")
        user_email = body.get("user_email")
        
        if not user_id:
            raise HTTPException(status_code=400, detail="Missing user_id")
            
        checkout_url = PaymentService.create_checkout_session(user_id, user_email)
        return {"url": checkout_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Webhook 接口：处理支付成功回调 ---
#@app.post("/api/v1/payment/webhook")
async def stripe_webhook(request: Request, stripe_signature: str = Header(None)):
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, settings.STRIPE_WEBHOOK_SECRET
        )
        
        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            
            # 🚨 极简访问法，绕过所有属性查找报错
            try:
                user_id = session['metadata']['user_id']
                print(f"💰 识别到 UserID: {user_id}")
                
                # 升级权限
                from services.user_service import UserService
                UserService.upgrade_user_to_pro(user_id)
                print(f"✅ 权限升级指令已发出")
            except KeyError:
                print("⚠️ Webhook 错误：Metadata 中缺少 user_id")
                
        return {"status": "success"}
    except Exception as e:
        print(f"🚨 Webhook 崩溃详情: {str(e)}")
        # 返回 400 让 Stripe 稍后重试
        raise HTTPException(status_code=400, detail=str(e))

    return {"status": "success"}

@app.post("/api/v1/evaluate/process")
async def process_evaluation(request: Request):
    # 1. 获取请求数据
    body = await request.json()
    work_text = body.get("work_text")
    image_data = body.get("image_data") # 前端传来的 base64
    
    # 2. 模拟从 session/token 获取用户 metadata (实际应通过依赖注入)
    # 假设你已经有了 user_metadata
    user_metadata = {"is_paid": True} # 示例
    
    # 3. 调用 AI 服务
    report = await AIService.evaluate_work(work_text, user_metadata, image_data)
    
    return {"report": report}

# --- AI 评审接口示例 ---
@app.post("/api/v1/evaluate/pro")
async def evaluate_pro(request: Request):
    # 这里是你的 AI 评审逻辑
    # 可以在这里校验用户的 is_paid 状态后再提供服务
    return {"report": "这是来自 NAL 专家模型的深度评审报告..."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
