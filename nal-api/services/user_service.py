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

   class UserService:
    @staticmethod
    def upgrade_user_to_pro(user_id: str, plan: str = "contestant"):
        try:
            user_res = UserService.get_user_by_id(user_id)
            meta = user_res.user.user_metadata or {}
            
            # 🚨 逻辑 A：购买加油包 (addon)
            if plan == "addon":
                # 记录标记：用于后续 apply_free_contestant 的防刷
                meta["has_bought_booster"] = True 
                meta["is_paid"] = True
                
                # 💡 关键：这里绝不修改 meta["role"]
                # 普通用户买完后 role 依然是 None，保持其“无参赛资格”状态
                
                # 增加 5 次全项资源
                meta["flash_left"] = (meta.get("flash_left") or 0) + 5
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5

            # 🚨 逻辑 B：购买参赛费 (contestant)
            elif plan == "contestant":
                meta["role"] = "contestant" # 赋予参赛身份
                meta["is_paid"] = True
                # 增加配套资源
                meta["flash_left"] = (meta.get("flash_left") or 0) + 5
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5

            # 🚨 逻辑 C：升级专业版 (pro) —— 保持原有逻辑不动
            elif plan == "pro":
                meta["role"] = "pro"
                meta["is_paid"] = True
                # 赋予无限或高额权限
                meta["flash_left"] = 9999
                meta["guide_pro"] = 9999
                meta["text_pro"] = 9999
                meta["illustration_pro"] = 9999

            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
        except Exception as e:
            raise e

    @staticmethod
    def apply_free_contestant(user_id: str):
        try:
            user_res = UserService.get_user_by_id(user_id)
            meta = user_res.user.user_metadata or {}
            
            if meta.get("role") in ["pro", "contestant"]:
                return True, "已具备资格"
                
            # 1. 改变身份为参赛者
            meta["role"] = "contestant"
            
            # 2. 检查是否通过 addon 提前领过资源了
            if meta.get("has_bought_booster") == True:
                # 仅改身份，不加额度
                print(f"用户 {user_id} 已购包，报名不加额度")
            else:
                # 纯新号，赠送 5 次初始额度
                meta["guide_pro"] = (meta.get("guide_pro") or 0) + 5
                meta["text_pro"] = (meta.get("text_pro") or 0) + 5
                meta["illustration_pro"] = (meta.get("illustration_pro") or 0) + 5

            supabase_admin.auth.admin.update_user_by_id(user_id, attributes={'user_metadata': meta})
            return True, "报名成功"
        except Exception as e:
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
