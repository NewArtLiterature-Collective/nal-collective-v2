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
    def _get_current_contest_id():
        """
        内部动态配置抓取器：实时去 site_settings 动态单例表获取当前举办的赛事 ID
        """
        try:
            res = supabase_admin.from_("site_settings").select("current_contest_id").single().execute()
            if res.data:
                return res.data.get("current_contest_id", "default_v1")
        except Exception as e:
            print(f"⚠️ 警告：从配置表抓取 current_contest_id 失败: {e}，启用保底默认 ID")
        return "default_v1"

    @staticmethod
    def get_user_by_id(user_id: str):
        """
        获取用户核心方法：注入动态过期自愈清洗，剥离历史残留布尔特权
        """
        try:
            res = supabase_admin.auth.admin.get_user_by_id(user_id)
            if not res or not hasattr(res, 'user'):
                return res
                
            user = res.user
            meta = user.user_metadata or {}
            
            # 🚨 核心增强：自然过期静默清洗自愈防线
            if meta.get("role") == "pro" and meta.get("expiry_date"):
                try:
                    # 1. Python 3.14 原生完美解析带 'Z' 后缀的 UTC 字符串，得到 offset-aware datetime
                    expiry_dt = datetime.fromisoformat(meta.get("expiry_date"))
                    
                    # 2. 必须使用带 UTC 时区的当前时间进行对撞对比，否则会报 TypeError
                    if datetime.now(timezone.utc) > expiry_dt:
                        print(f"⚠️ 发现过期 Pro 用户 {user_id}（到期时间: {meta.get('expiry_date')}），执行强制静默降级并清洗残留状态...")
                        
                        # 3. 剥夺 Pro 身份，9999 滥用额度直接一刀切清零
                        meta["role"] = None  # 降级退化为普通用户
                        meta["flash_left"] = 3   
                        meta["pro_credits"] = 0
                        
                        # 🚨 4. 彻底物理粉碎历史旧布尔标记，防止污染前端卡槽
                        meta.pop("is_paid", None)
                        meta.pop("has_bought_booster", None)
                        
                        # 5. 实时写回 Supabase 数据库底层，完成净化自愈
                        supabase_admin.auth.admin._user_by_id(
                            user_id, 
                            attributes={'user_metadata': meta}
                        )
                except Exception as ex:
                    print(f"🚨 自动化过期拦截校验失败: {ex}")
                    
            return res
        except Exception as e:
            print(f"❌ 获取用户失败: {e}")
            return None

    @classmethod
    def update_user_metadata(cls, user_id: str, new_meta: dict):
        """
        直接用计算好的新字典覆盖 Supabase 中的 user_metadata
        """
        # 假设你的 supabase 管理员客户端变量名叫 supabase_admin (请依据你的实际命名调整)
        supabase_admin.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": new_meta}
        )    
    
    @staticmethod
    def upgrade_user_to_pro(user_id: str, plan: str = "contestant"):
        """
        支付回调后的发货车间（完全剥离永久布尔值污染，硬咬合赛事唯一ID）
        """
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return
            meta = user_res.user.user_metadata or {}
            
            # 🚨 1. 动态获取当前赛季的唯一标识符（例如: "2026_children_v1"）
            current_id = UserService._get_current_contest_id()
            
            # 📦 逻辑 1：资源加油包 (addon)
            if plan == "addon":
                # 🚨 核心修正：弃用永久布尔值，改用赛季 ID 绑定。记录用户在“这一届”赛事中买过包
                meta["booster_contest_id"] = current_id  
                meta.pop("has_bought_booster", None)  # 静默洗净旧字段
                
                # 类型安全防护加算
                current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                
                meta["flash_left"] = current_flash + 3
                meta["pro_credits"] = current_pro + 2
                print(f"📦 用户 {user_id} 获得加油包：+3 Flash, +2 Pro。绑定赛事: {current_id}")

            # 🏆 逻辑 2：大奖赛门票/参赛费 (contestant)
            elif plan == "contestant":
                meta["role"] = "contestant" 
                # 🚨 核心修正：彻底废弃 meta["is_paid"] = True，改用专属当季门票锁定
                meta["paid_contest_id"] = current_id  
                meta.pop("is_paid", None)  # 静默洗净旧字段
                
                # 🚨 防重发逻辑重构：只有当用户【在本赛季内没有买过加油包】时，才白送 3+2 初始额度
                if meta.get("booster_contest_id") != current_id:
                    current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                    current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                    
                    meta["flash_left"] = current_flash + 3
                    meta["pro_credits"] = current_pro + 2
                    print(f"🏆 用户 {user_id} 成功报名【{current_id}】大奖赛，发放初始资源：+3 Flash, +2 Pro。")
                else:
                    print(f"🏆 用户 {user_id} 报名成功【{current_id}】，因本赛季已提前购买加油包，不再重复白送资源。")

            # ✨ 逻辑 3：年费专业版 (pro)
            elif plan == "pro":
                meta["role"] = "pro"
                
                # 顺手清理历史旧残留标记，保持元数据结构高度一致
                meta.pop("is_paid", None)
                meta.pop("has_bought_booster", None)
                
                # 设置有效期：严格采用标准 UTC 时间，并在尾部追加 Z 标识
                expiry_date = datetime.now(timezone.utc) + timedelta(days=365)
                meta["expiry_date"] = expiry_date.strftime('%Y-%m-%dT%H:%M:%SZ')
                
                # 资源拉满
                meta["flash_left"] = 9999 
                meta["pro_credits"] = 9999
                
                # 初始化每日 Pro 计数器
                meta["pro_daily_used"] = 0
                meta["last_active_date"] = datetime.now().date().isoformat()
                
                print(f"✨ 用户 {user_id} 升级为年费专业版，有效期至 {meta['expiry_date']}")
            
            # 2. 持久化同步写回 Supabase 数据库底层
            supabase_admin.auth.admin._user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
        except Exception as e:
            print(f"❌ 发货车间数据库写入失败: {e}")
            raise e

    @staticmethod
    def apply_free_contestant(user_id: str):
        """
        处理前端“免费报名参赛”逻辑（动态防刷机制）
        如果用户已经在花钱买了当季加油包，然后再点免费报名，只给当季门票，不再白送额度。
        """
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return False, "用户不存在"
            meta = user_res.user.user_metadata or {}
            
            # 🚨 1. 获取当季唯一的赛事 ID
            current_id = UserService._get_current_contest_id()
            
            # 🚨 2. 核心修正：多赛季隔离的身份合法性碰撞
            is_current_contestant = (meta.get("role") == "contestant" and meta.get("paid_contest_id") == current_id)
            is_pro = (meta.get("role") == "pro")
            
            if is_pro or is_current_contestant:
                return True, "您已具备相应资格"
                
            # 给予参赛者当季专属门票
            meta["role"] = "contestant"
            meta["paid_contest_id"] = current_id
            meta.pop("is_paid", None)  # 清除可能存在的老字段
            
            # 🚨 3. 核心修正：防刷机制彻底咬合当季加油包绑定标识
            if meta.get("booster_contest_id") == current_id:
                print(f"⚠️ 用户 {user_id} 免费报名成功（本赛季已提前购包，不送资源）。")
            else:
                # 类型安全加算防护
                current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                
                meta["flash_left"] = current_flash + 3
                meta["pro_credits"] = current_pro + 2
                print(f"🏆 用户 {user_id} 免费报名成功，获得资格及资源：+3 Flash, +2 Pro。")
                
            supabase_admin.auth.admin._user_by_id(
                user_id, 
                attributes={'user_metadata': meta}
            )
            return True, "报名成功"
        except Exception as e:
            print(f"❌ 免费报名车间执行崩溃: {e}")
            raise e
