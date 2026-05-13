import os
from supabase import create_client
from dotenv import load_dotenv, find_dotenv

# 加载环境变量
load_dotenv(find_dotenv())

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL:
    print("⚠️ 致命错误：未找到 SUPABASE_URL 环境变量！")

# 初始化上帝视角的 Admin 客户端
supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY if SUPABASE_SERVICE_KEY else os.getenv("SUPABASE_KEY"))

class UserService:
    
    @staticmethod
    def get_user_by_id(user_id: str):
        """封装获取用户的方法，方便多处调用"""
        try:
            return supabase_admin.auth.admin.get_user_by_id(user_id)
        except Exception as e:
            print(f"❌ 获取用户失败: {e}")
            return None

    @staticmethod
    def upgrade_user_to_pro(user_id: str, plan: str = "contestant"):
        """
        支付成功后的发货逻辑
        1. plan == 'addon' (加油包)：不修改 role，仅增加资源。
        2. plan == 'contestant' (参赛费)：修改 role 为 contestant，增加初始资源。
        3. plan == 'pro' (专业版)：修改 role 为 pro，赋予无限资源。
        """
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res: return
            
            meta = user_res.user.user_metadata or {}
            
            # 🚨 模式 1：专业版 (Pro)
            if plan == "pro":
                meta.update({
                    "is_paid": True,
                    "role": "pro",
                    "flash_left": 9999,
                    "guide_pro": 9999,
                    "text_pro": 9999,
                    "illustration_pro": 9999
                })
            
            # 🚨 模式 2：加油包 (addon)
            elif plan == "addon":
                meta["is_paid"] = True
                meta["has_bought_booster"] = True # 标记买过加油包
                
                # 💡 核心：这里绝对不写 meta["role"] = ...
                # 确保普通用户买完后依然没有 role，实现“购买加油包不获得参赛资格”
                
                # 增加额度 (使用 .get(..., 0) 确保不会因为 None + 5 崩溃)
                meta["flash_left"] = (meta.get("flash_left") or 0) + 5
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5

            # 🚨 模式 3：参赛资格 (contestant)
            elif plan == "contestant":
                meta.update({
                    "is_paid": True,
                    "role": "contestant",
                    "flash_left": (meta.get("flash_left") or 0) + 5,
                    "guide_pro": (meta.get("guide_pro") or 0) + 5,
                    "text_pro": (meta.get("text_pro") or 0) + 5,
                    "illustration_pro": (meta.get("illustration_pro") or 0) + 5
                })

            # 统一保存更新
            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            print(f"✅ 支付处理成功：用户 {user_id} 获得 {plan} 权益。")
        except Exception as e:
            print(f"❌ 数据库写入失败: {e}")
            raise e

    @staticmethod
    def apply_free_contestant(user_id: str):
        """
        处理前端“免费报名参赛”逻辑
        解决：买过加油包的用户点击报名，不再获得额外赠送的 5 次额度
        """
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res: return False, "用户不存在"
            
            meta = user_res.user.user_metadata or {}
            
            # 如果已经是 Pro 或 参赛者，跳过
            if meta.get("role") in ["pro", "contestant"]:
                return True, "您已具备相应资格"
                
            # 1. 给予“参赛者”身份
            meta["role"] = "contestant"
            
            # 2. 💡 核心防刷：检查是否买过加油包
            if meta.get("has_bought_booster") == True:
                # 买过包的人：只给名分，不给钱（额度）
                print(f"⚠️ 用户 {user_id} 已购加油包，点击报名不重复赠送额度。")
            else:
                # 纯新用户：赠送初始 5 次额度
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5

            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            return True, "报名成功"
        except Exception as e:
            print(f"❌ 报名处理异常: {e}")
            raise e

    @staticmethod
    def deduct_user_credit(user_id: str, task_type: str, used_pro: bool):
        """AI 评审成功后的扣费逻辑"""
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res: return
            
            meta = user_res.user.user_metadata or {}
            
            if used_pro:
                field_name = f"{task_type}_pro"
                current_val = meta.get(field_name, 0)
                if current_val > 0:
                    meta[field_name] = current_val - 1
            else:
                current_flash = meta.get("flash_left", 0)
                if current_flash > 0:
                    meta["flash_left"] = current_flash - 1

            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            print(f"💰 用户 {user_id} 扣费成功。")
        except Exception as e:
            print(f"❌ 扣费失败: {e}")
            raise e
