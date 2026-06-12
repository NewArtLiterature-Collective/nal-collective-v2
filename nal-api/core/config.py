from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # 确保这些是大写的，对应 .env 里的等号左边
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    GEMINI_API_KEY: str  # <--- 我们统一用大写
    FRONTEND_URL: str    # 本地 .env 设为 http://localhost:5173，线上设为 https://v2.nal-ai.org
    
    STRIPE_SECRET_KEY: str
    STRIPE_WEBHOOK_SECRET: str

    ADMIN_SECRET_KEY: str

    # 🚨 这是解决 "Extra inputs are not permitted" 的关键
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"  # 允许 .env 中存在类里没定义的变量（比如旧的小写变量）
    )

settings = Settings()
