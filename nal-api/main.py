# nal-api/main.py
import stripe
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from routes import admin

# 导入你的路由模块
from routes.evaluation import router as evaluation_router
from routes import payment
from routes import gallery  # 🆕 展厅签名接口（私有桶下展厅取图）
from routes import contest  # 🆕 参赛投稿接口（经后端校验 + 平台级拦截）
from routes import account  # 🆕 用户自助注销账号
from routes import media  # 🆕 文件上传 / 签名（Cloudflare R2）

app = FastAPI(title="NAL API")

# --- 1. 配置 CORS (允许前端访问) ---
# 注意：allow_origins=["*"] 时 allow_credentials 必须为 False
# 前端用 Authorization header 传 token，不依赖 cookie，所以没有影响
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)

# --- 2. 初始化 Stripe ---
stripe.api_key = settings.STRIPE_SECRET_KEY_EFFECTIVE
print(f"💳 Stripe 模式: {'LIVE（真实收款）' if settings.STRIPE_USE_LIVE else 'TEST（沙盒）'}")

# --- 3. 注册路由 (核心修改点：统一在这里加前缀) ---
app.include_router(evaluation_router, prefix="/api/v1/evaluate", tags=["Evaluation"])
app.include_router(payment.router, prefix="/api/v1/payment", tags=["Payment"])
app.include_router(gallery.router, prefix="/api/v1", tags=["Exhibition"])  # 🆕 → /api/v1/gallery/images
app.include_router(contest.router, prefix="/api/v1/contest", tags=["Contest"])  # 🆕 → /api/v1/contest/submit
app.include_router(account.router, prefix="/api/v1/account", tags=["Account"])  # 🆕 → /api/v1/account/delete
app.include_router(media.router, prefix="/api/v1/media", tags=["Media"])  # 🆕 → /api/v1/media/*

# --- 4. 基础健康检查 ---
@app.get("/")
async def health_check():
    return {"status": "ok", "message": "NAL API Server is running smoothly"}

# 🚨 注意：这里不再有任何具体的 @app.post("/api/v1/payment/...") 代码

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
