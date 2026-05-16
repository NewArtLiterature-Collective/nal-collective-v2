import os
from datetime import datetime, timedelta, timezone  # 确保导入了 timezone
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
        """
        获取用户核心方法：注入动态过期自愈清洗，杜绝过期白嫖 9999 额度
        """
        try:
            res = supabase_admin.auth.admin.get_user_by_id(user_id)
            if not res or not hasattr(res, 'user'):
                return res
                
            user = res.user
            meta = user.user_metadata or {}
            
            # 🚨 核心新增：自然过期静默清洗自愈防线
            if meta.get("role") == "pro" and meta.get("expiry_date"):
                try:
                    # 1. Python 3.14 原生完美解析带 'Z' 后缀的 UTC 字符串，得到 offset-aware datetime
                    expiry_dt = datetime.fromisoformat(meta.get("expiry_date"))
                    
                    # 2. 必须使用带 UTC 时区的当前时间进行对撞对比，否则会报 TypeError
                    if datetime.now(timezone.utc) > expiry_dt:
                        print(f"⚠️ 发现过期 Pro 用户 {user_id}（到期时间: {meta.get('expiry_date')}），执行强制静默降级...")
                        
                        # 3. 剥夺 Pro 身份，9999 滥用额度直接一刀切清零
                        meta["role"] = None  # 降级退化为普通用户
                        meta["flash_left"] = 0   
                        meta["pro_credits"] = 0
                        
                        # 4. 实时写回 Supabase 数据库底层，完成净化自愈
                        supabase_admin.auth.admin.update_user_by_id(
                            user_id, 
                            attributes={'user_metadata': meta}
                        )
                except Exception as ex:
                    print(f"🚨 自动化过期拦截校验失败: {ex}")
                    
            return res
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
                meta["has_bought_booster"] = True  # 记录买过包
                
                # 加入 int() 强制转换，并处理可能存在的字符串或 None 溢出
                current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                
                meta["flash_left"] = current_flash + 2
                meta["pro_credits"] = current_pro + 3
                print(f"📦 用户 {user_id} 获得加油包：+2 Flash, +3 Pro。")

            # 🏆 逻辑 2：参赛费 (contestant)
            elif plan == "contestant":
                meta["role"] = "contestant" 
                meta["is_paid"] = True
                
                # 核心防叠加逻辑：只给没买过加油包的人发初始资源
                if not meta.get("has_bought_booster"):
                    current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                    current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                    
                    meta["flash_left"] = current_flash + 2
                    meta["pro_credits"] = current_pro + 3
                    print(f"🏆 用户 {user_id} 报名成功，获得资格及资源：+2 Flash, +3 Pro。")
                else:
                    print(f"🏆 用户 {user_id} 报名成功，已购加油包，不重复发放资源。")

            # ✨ 逻辑 3：专业版 (pro) —— 绝对不影响
            elif plan == "pro":
                meta["role"] = "pro"
                meta["is_paid"] = True
                
                # 设置有效期：严格采用标准 UTC 时间，并在尾部追加 Z 标识
                expiry_date = datetime.now(timezone.utc) + timedelta(days=365)
                meta["expiry_date"] = expiry_date.strftime('%Y-%m-%dT%H:%M:%SZ') # 完美的 2027-05-15T22:00:00Z 格式
                
                # 资源拉满
                meta["flash_left"] = 9999 
                meta["pro_credits"] = 9999
                
                # 初始化每日 Pro 计数器
                meta["pro_daily_used"] = 0
                meta["last_active_date"] = datetime.now().date().isoformat()
                
                print(f"✨ 用户 {user_id} 升级为专业版，有效期至 {meta['expiry_date']}")
            
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
                print(f"⚠️ 用户 {user_id} 报名成功（已购加油包，不送资源）。")
            else:
                # 同理进行安全加算防护
                current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                
                meta["flash_left"] = current_flash + 2
                meta["pro_credits"] = current_pro + 3
                print(f"🏆 用户 {user_id} 报名成功，获得资格及资源：+2 Flash, +3 Pro。")
                
            supabase_admin.auth.admin.update_user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            return True, "报名成功"
        except Exception as e:
            raise e
