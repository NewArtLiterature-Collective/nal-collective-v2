from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.database import supabase_db

# 声明使用 Bearer Token 进行鉴权
security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    核心鉴权逻辑：验证 Token 并组装用户身份与权限字典
    """
    token = credentials.credentials
    try:
        # 1. 验证 JWT 并获取基础 auth.users 信息
        user_res = supabase_db.auth.get_user(token)
        if not user_res or not user_res.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail="无效的登录凭证，请重新登录"
            )
        
        # 2. 跨表查询业务角色 (基础版 / 专业版)
        user_id = user_res.user.id
        profile_res = supabase_db.table("profiles").select("*").eq("id", user_id).single().execute()
        
        # 如果新用户还没生成 profile，默认给予 basic 权限和 5 次体验额度
        profile_data = profile_res.data if profile_res.data else {
            "role": "basic", 
            "flash_credits": 5,
            "has_paid_competition": False
        }

        return {"auth": user_res.user, "profile": profile_data}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail=f"鉴权失败: {str(e)}"
        )

def require_role(allowed_roles: list[str]):
    """
    权限工厂函数：用于在具体的 API 路由上加锁
    例如：@app.get("/pro-eval", dependencies=[Depends(require_role(["pro", "admin"]))])
    """
    def role_checker(current_user: dict = Depends(get_current_user)):
        user_role = current_user["profile"].get("role", "basic")
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail=f"越权访问。当前角色：{user_role}，需要：{allowed_roles}。请升级您的订阅计划。"
            )
        return current_user
    return role_checker