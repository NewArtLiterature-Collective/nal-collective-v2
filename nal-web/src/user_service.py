from supabase import create_client
from core.config import settings

# 初始化一个具有 Service Role Key 权限的客户端 (用于绕过 RLS 修改权限)
# 注意：此处的 key 必须是 Supabase 后端的 SERVICE_ROLE_KEY，不能是公钥
supabase_admin = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

class UserService:
    @staticmethod
    def upgrade_user_to_pro(user_id: str):
        try:
            # 修改 profiles 表中的角色
            result = supabase_admin.table("profiles").update({"role": "pro"}).eq("id", user_id).execute()
            return result
        except Exception as e:
            print(f"权限升级失败: {str(e)}")
            raise e