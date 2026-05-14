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
        支付回调后的发货车间
        """
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return
            meta = user_res.user.user_metadata or {}
            
            # 📦 逻辑 1：加油包 (addon)
            if plan == "addon":
                meta["has_bought_booster"] = True  # 👈 记录买过包
                meta["flash_left"] = (meta.get("flash_left") or 0) + 2
                meta["pro_credits"] = (meta.get("pro_credits") or 0) + 3
                print(f"📦 用户 {user_id} 获得加油包：+2 Flash, +3 Pro。")

            # 🏆 逻辑 2：参赛费 (contestant)
            elif plan == "contestant":
                meta["role"] = "contestant" # 给予门票
                meta["is_paid"] = True
                
                # 🚨 核心防叠加逻辑：只给没买过加油包的人发初始资源
                if not meta.get("has_bought_booster"):
                    meta["flash_left"] = (meta.get("flash_left") or 0) + 2
                    meta["pro_credits"] = (meta.get("pro_credits") or 0) + 3
                    print(f"🏆 用户 {user_id} 报名成功，获得资格及资源：+2 Flash, +3 Pro。")
                else:
                    print(f"🏆 用户 {user_id} 报名成功")

            # ✨ 逻辑 3：专业版 (pro) —— 绝对不影响
            elif plan == "pro":
                meta["role"] = "pro"
                meta["is_paid"] = True
                meta.update({
                    "flash_left": 9999,
                    "pro_credits": 9999
                })
                print(f"✨ 用户 {user_id} 升级为专业版，资源已拉满。")

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
        如果用户已经花钱买了加油包，然后再点免费报名，只给门票，不再白送额度。
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
                print(f"⚠️ 用户 {user_id} 报名成功。")
            else:
                # 🚨 核心修改：对齐最新的发货标准 (2次Flash, 3次共享Pro)
                meta["flash_left"] = (meta.get("flash_left") or 0) + 2
                meta["pro_credits"] = (meta.get("pro_credits") or 0) + 3
                print(f"🏆 用户 {user_id} 报名成功，获得资格及资源：+2 Flash, +3 Pro。")

            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            return True, "报名成功"
        except Exception as e:
            raise e
