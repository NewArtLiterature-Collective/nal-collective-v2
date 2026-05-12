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
        支付成功后的发货逻辑：为用户打上参赛标签，并充值 Pro 额度
        """
        try:
            # 1. 获取用户当前的元数据
            user_res = supabase_admin.auth.admin.get_user_by_id(user_id)
            meta = user_res.user.user_metadata or {}
            
            # 🚨 完善专业版：如果是购买 Pro
            if plan == "pro":
                meta["is_paid"] = True
                meta["role"] = "pro"
                meta["flash_left"] = 9999  # Pro 其实不扣费，给个大数字让前端显示好看
            
            #🚨 2. 逻辑分流：只有购买的是“参赛资格 (contestant)”，才改变用户身份
            elif plan == "contestant":
                meta["is_paid"] = True
                meta["role"] = "contestant"
            
            # 🚨 3. 无论买的是报名费还是加油包，都无脑叠加 5 次各项高级额度
            meta["flash_left"] = meta.get("flash_left", 5) + 5
            meta["guide_pro"] = meta.get("guide_pro", 0) + 5
            meta["text_pro"] = meta.get("text_pro", 0) + 5
            meta["illustration_pro"] = meta.get("illustration_pro", 0) + 5

            # 4. 强制更新写回 Supabase
            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            print(f"✅ 数据库操作成功：用户 {user_id} 已升级为（{plan}) 并到账额度！")
        except Exception as e:
            print(f"❌ 数据库写入失败: {e}")
            raise e

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