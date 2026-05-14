import os
from supabase import create_client
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_admin = create_client(
    SUPABASE_URL, 
    SUPABASE_SERVICE_KEY if SUPABASE_SERVICE_KEY else os.getenv("SUPABASE_KEY")
)

class UserService:
    @staticmethod
    def get_user_by_id(user_id: str):
        try:
            return supabase_admin.auth.admin.get_user_by_id(user_id)
        except Exception as e:
            print(f"❌ 获取用户失败: {e}")
            return None

    @staticmethod
    def upgrade_user_to_pro(user_id: str, plan: str = "contestant"):
        """
        支付回调后的发货车间：严格执行“身份与物资分离”
        """
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return
            meta = user_res.user.user_metadata or {}
            
            # 📦 逻辑 1：加油包 (addon) - 20元
            if plan == "addon":
                meta["has_bought_booster"] = True # 标记买过包，用于防刷
                
                # 🚨 核心控制：绝对不写 meta["role"] = ...
                # 这保证了普通用户买完包后，role 依然为空，【不能获得参赛资格】
                
                # 发放 5 次专属额度（根据表格，基础和高级都给5次）
                meta["flash_left"] = (meta.get("flash_left") or 0) + 5
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5
                
                print(f"📦 用户 {user_id} 获得加油包物资，身份保持不变。")

            # 🏆 逻辑 2：参赛费 (contestant) - 10元
            elif plan == "contestant":
                meta["role"] = "contestant" # 👈 只有这里才给参赛门票！
                meta["is_paid"] = True
                
                # 发放初始报名配套物资
                meta["flash_left"] = (meta.get("flash_left") or 0) + 5
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5
                
                print(f"🏆 用户 {user_id} 获得参赛资格及初始物资。")

            # ✨ 逻辑 3：专业版 (pro) - 300元
            elif plan == "pro":
                meta["role"] = "pro"
                meta["is_paid"] = True
                meta.update({
                    "flash_left": 9999,
                    "guide_pro": 9999,
                    "text_pro": 9999,
                    "illustration_pro": 9999
                })
                print(f"✨ 用户 {user_id} 升级为专业版，获得无限物资。")

            # 统一将修改写回数据库
            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
        except Exception as e:
            print(f"❌ 数据库写入失败: {e}")
            raise e

    @staticmethod
    def apply_free_contestant(user_id: str):
        """
        处理前端“免费报名参赛”逻辑（防刷机制）
        如果用户已经花 20 块钱买了包，然后再点免费报名，只给门票，不再白送额度。
        """
        try:
            user_res = UserService.get_user_by_id(user_id)
            meta = user_res.user.user_metadata or {}
            
            if meta.get("role") in ["pro", "contestant"]:
                return True, "您已具备相应资格"
                
            # 给予参赛者门票
            meta["role"] = "contestant"
            
            # 💡 防刷：检查是否买过加油包
            if meta.get("has_bought_booster"):
                print(f"⚠️ 用户 {user_id} 已购加油包，本次只给参赛资格，不重复送额度。")
            else:
                # 纯新用户报名，赠送 5 次额度
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5

            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            return True, "报名成功"
        except Exception as e:
            raise e
