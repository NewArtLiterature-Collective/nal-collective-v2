import stripe
from core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

class PaymentService:
    @staticmethod
    def create_checkout_session(user_id: str, user_email: str, plan: str = 'contestant'):
        try:
            # 1. 动态配置商品信息 (10元 / 20元 / 300元)
            if plan == 'pro':
                product_name = 'NAL 专业会员 (1年期)'
                amount = 30000  # 300.00 CNY
            elif plan == 'contestant':
                product_name = 'NAL“童心”征文大赛 报名资格'
                amount = 1000   # 10.00 CNY
            else:
                product_name = 'NAL 资源加油包'
                amount = 2000   # 20.00 CNY

            # 2. 创建 Stripe 支付会话
            session = stripe.checkout.Session.create(
                payment_method_types=['card', 'alipay', 'wechat_pay'],
                
                # 🚨 核心补救：把微信支付的 web 声明补回来！否则会报 500 错误
                payment_method_options={
                    "wechat_pay": {
                        "client": "web"
                    }
                },
                
                line_items=[{
                    'price_data': {
                        'currency': 'cny', 
                        'product_data': {
                            'name': product_name,
                        },
                        'unit_amount': amount,
                    },
                    'quantity': 1,
                }],
                mode='payment',
                success_url=f"{settings.FRONTEND_URL}/dashboard?session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{settings.FRONTEND_URL}/dashboard",
                metadata={
                    "user_id": user_id,
                    "email": user_email,
                    "plan": plan  # 确保套餐标记传给 Webhook
                }
            )
            return session.url
        except Exception as e:
            print(f"Stripe API Error: {str(e)}")
            raise Exception(f"Stripe 会话创建失败: {str(e)}")