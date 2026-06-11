# nal-api/main.py
import stripe
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from routers import admin

# 导入你的路由模块
from routes.evaluation import router as evaluation_router
from routes import payment

app = FastAPI(title="NAL API")

# --- 1. 配置 CORS (允许前端访问) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://v2.nal-ai.org"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. 初始化 Stripe ---
stripe.api_key = settings.STRIPE_SECRET_KEY

# --- 3. 注册路由 (核心修改点：统一在这里加前缀) ---
app.include_router(evaluation_router, prefix="/api/v1/evaluate", tags=["Evaluation"])
app.include_router(payment.router, prefix="/api/v1/payment", tags=["Payment"])

# --- 4. 基础健康检查 ---
@app.get("/")
async def health_check():
    return {"status": "ok", "message": "NAL API Server is running smoothly"}

# 🚨 注意：这里不再有任何具体的 @app.post("/api/v1/payment/...") 代码

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
