from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # 确保这些是大写的，对应 .env 里的等号左边
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    GEMINI_API_KEY: str  # <--- 我们统一用大写
    FRONTEND_URL: str    # 本地 .env 设为 http://localhost:5173，线上设为 https://v2.nal-ai.org

    # --- Stripe 沙盒（测试）密钥：默认使用，调试环境常驻 ---
    STRIPE_SECRET_KEY: str
    STRIPE_WEBHOOK_SECRET: str

    # --- 🚀 Stripe 真实（live）密钥：与沙盒并存，仅在 STRIPE_USE_LIVE=true 时启用 ---
    #     v2 做真实账户验证时在 v2 上把开关打开；www 生产服务常开。
    STRIPE_SECRET_KEY_ONLINE: Optional[str] = None
    STRIPE_WEBHOOK_SECRET_ONLINE: Optional[str] = None
    # 收款模式开关：false=沙盒（默认，安全）；true=真实收款（用 _ONLINE 那套）
    STRIPE_USE_LIVE: bool = False

    ADMIN_SECRET_KEY: str

    # 🚨 这是解决 "Extra inputs are not permitted" 的关键
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"  # 允许 .env 中存在类里没定义的变量（比如旧的小写变量）
    )

    @property
    def STRIPE_SECRET_KEY_EFFECTIVE(self) -> str:
        """按 STRIPE_USE_LIVE 决定实际使用的 Stripe 密钥。"""
        if self.STRIPE_USE_LIVE:
            if not self.STRIPE_SECRET_KEY_ONLINE:
                raise RuntimeError("STRIPE_USE_LIVE=true 但未配置 STRIPE_SECRET_KEY_ONLINE")
            return self.STRIPE_SECRET_KEY_ONLINE
        return self.STRIPE_SECRET_KEY

    @property
    def STRIPE_WEBHOOK_SECRET_EFFECTIVE(self) -> str:
        """按 STRIPE_USE_LIVE 决定实际使用的 webhook 签名密钥。"""
        if self.STRIPE_USE_LIVE:
            if not self.STRIPE_WEBHOOK_SECRET_ONLINE:
                raise RuntimeError("STRIPE_USE_LIVE=true 但未配置 STRIPE_WEBHOOK_SECRET_ONLINE")
            return self.STRIPE_WEBHOOK_SECRET_ONLINE
        return self.STRIPE_WEBHOOK_SECRET

settings = Settings()
