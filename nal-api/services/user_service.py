import os
from supabase import create_client
from dotenv import load_dotenv, find_dotenv  # 🚨 新增：引入 find_dotenv

# 🚨 核心修复：自动向上级目录寻找 .env 文件并加载
load_dotenv(find_dotenv())

# 🚨 必须使用 Supabase 的 Service Role Key 才能修改其他用户的权限！
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 增加一个检查打印，防止后续盲猜
if not SUPABASE_URL:
    print("⚠️ 致命错误：未找到 SUPABASE_URL 环境变量，请检查 .env 文件！")

# 初始化上帝视角的 Admin 客户端
if SUPABASE_SERVICE_KEY:
    supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
else:
    # 如果没有配置 service key，先用普通 key 兜底
    supabase_admin = create_client(SUPABASE_URL, os.getenv("SUPABASE_KEY"))

class UserService:
    
    @staticmethod
    def upgrade_user_to_pro(user_id: str, plan: str = "contestant"):
        """
        支付成功后的发货逻辑：严格区分 Pro、参赛费 和 加油包
        """
        try:
            # 1. 获取用户当前的元数据
            user_res = supabase_admin.auth.admin.get_user_by_id(user_id)
            meta = user_res.user.user_metadata or {}
            
            # 🚨 模式 A：购买 Pro 会员
            if plan == "pro":
                meta["is_paid"] = True
                meta["role"] = "pro"
                meta["flash_left"] = 9999  # Pro 不扣费，给个大数字让前端显示好看
            
            # 🚨 模式 B：购买“加油包 (booster)” (修复第 4 点)
            elif plan == "booster":
                meta["is_paid"] = True
                # 核心防刷标记：打上终身买过加油包的烙印，【绝不改变 role 字段】！
                meta["has_bought_booster"] = True 
                
                # 叠加购买的额度
                meta["flash_left"] = meta.get("flash_left", 5) + 5
                meta["guide_pro"] = meta.get("guide_pro", 0) + 5
                meta["text_pro"] = meta.get("text_pro", 0) + 5
                meta["illustration_pro"] = meta.get("illustration_pro", 0) + 5

            # 🚨 模式 C：购买“参赛资格 (contestant)”
            elif plan == "contestant":
                meta["is_paid"] = True
                meta["role"] = "contestant"
                
                # 叠加报名费里包含的初始额度
                meta["flash_left"] = meta.get("flash_left", 5) + 5
                meta["guide_pro"] = meta.get("guide_pro", 0) + 5
                meta["text_pro"] = meta.get("text_pro", 0) + 5
                meta["illustration_pro"] = meta.get("illustration_pro", 0) + 5

            # 4. 强制更新写回 Supabase
            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            print(f"✅ 数据库操作成功：用户 {user_id} 已处理支付（{plan}) 并到账额度！")
        except Exception as e:
            print(f"❌ 数据库写入失败: {e}")
            raise e

    @staticmethod
    def apply_free_contestant(user_id: str):
        """
        🚨 修复第 5 点：前端点击免费“报名参赛”时的专属处理接口
        （如果是免费点击报名，请在路由中调用这个函数）
        """
        try:
            user_res = supabase_admin.auth.admin.get_user_by_id(user_id)
            meta = user_res.user.user_metadata or {}
            
            if meta.get("role") in ["pro", "contestant"]:
                return False, "您已具备高级或参赛资格，无需重复报名。"
                
            # 给予参赛者名分
            meta["role"] = "contestant"
            
            # 💡 核心防刷逻辑：检查是否买过加油包
            if meta.get("has_bought_booster") == True:
                # 买过加油包：只改名分，绝不白送那 5 次免费额度
                print(f"⚠️ 用户 {user_id} 买过加油包，本次免费报名不赠送额度。")
            else:
                # 纯新用户报名：白送 5 次初始高级额度
                meta["guide_pro"] = meta.get("guide_pro", 0) + 5
                meta["text_pro"] = meta.get("text_pro", 0) + 5
                meta["illustration_pro"] = meta.get("illustration_pro", 0) + 5

            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            return True, "报名成功"
        except Exception as e:
            print(f"❌ 免费报名处理失败: {e}")
            raise e

    @staticmethod
    def deduct_user_credit(user_id: str, task_type: str, used_pro: bool):
        # ... [保留你原有的 deduct_user_credit 代码完全不变] ...
        pass
    @staticmethod
    def deduct_user_credit(user_id: str, task_type: str, used_pro: bool):
        """
        AI 评审成功后的扣费逻辑
        """
        try:
            user_res = supabase_admin.auth.admin.get_user_by_id(user_id)
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
