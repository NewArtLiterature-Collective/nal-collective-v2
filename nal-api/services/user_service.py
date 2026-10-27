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
    # ==========================================================
    # 🔒 权益权威来源 = app_metadata（仅 service_role 可写，用户改不了）：
    #    role / flash_left / pro_credits / expiry_date / paid_contest_id /
    #    booster_contest_id / pro_daily_used / last_active_date。
    #    user_metadata 只放用户自有资料（real_name/phone/gender/agreed_contests），本服务不碰。
    # ==========================================================
    @staticmethod
    def _save_entitlements(user_id: str, app_meta: dict):
        """把整份权益字典写回 app_metadata。"""
        supabase_admin.auth.admin.update_user_by_id(
            user_id, {"app_metadata": app_meta}
        )

    @staticmethod
    def _get_current_contest_id():
        """实时去 site_settings 动态单例表获取当前举办的赛事 ID"""
        try:
            res = supabase_admin.from_("site_settings").select("current_contest_id").single().execute()
            if res.data:
                return res.data.get("current_contest_id", "default_v1")
        except Exception as e:
            print(f"⚠️ 警告：从配置表抓取 current_contest_id 失败: {e}，启用保底默认 ID")
        return "default_v1"

    @staticmethod
    def get_user_by_id(user_id: str):
        """获取用户核心方法：注入动态过期自愈清洗（权益均在 app_metadata）"""
        try:
            res = supabase_admin.auth.admin.get_user_by_id(user_id)
            if not res or not hasattr(res, 'user'):
                return res

            user = res.user
            app = user.app_metadata or {}

            # 🚨 自然过期静默清洗自愈防线
            if app.get("role") == "pro" and app.get("expiry_date"):
                try:
                    expiry_dt = datetime.fromisoformat(app.get("expiry_date"))
                    if datetime.now(timezone.utc) > expiry_dt:
                        print(f"⚠️ 发现过期 Pro 用户 {user_id}（到期: {app.get('expiry_date')}），强制静默降级...")
                        app["role"] = "free"
                        app["expiry_date"] = None
                        app["flash_left"] = 3
                        app["pro_credits"] = 0
                        app.pop("is_paid", None)
                        app.pop("has_bought_booster", None)
                        UserService._save_entitlements(user_id, app)
                except Exception as ex:
                    print(f"🚨 自动化过期拦截校验失败: {ex}")

            return res
        except Exception as e:
            print(f"❌ 获取用户失败: {e}")
            return None

    @classmethod
    def update_user_metadata(cls, user_id: str, new_meta: dict):
        """
        兼容旧调用：把传入的权益字典合并写入 app_metadata（历史上它写的就是权益）。
        role 等字段不再落 user_metadata。
        """
        try:
            res = supabase_admin.auth.admin.get_user_by_id(user_id)
            existing = (res.user.app_metadata or {}) if res and hasattr(res, 'user') else {}
        except Exception:
            existing = {}
        merged = {**existing, **(new_meta or {})}
        merged.pop("is_paid", None)
        cls._save_entitlements(user_id, merged)

    @staticmethod
    def upgrade_user_to_pro(user_id: str, plan: str = "contestant"):
        """支付回调后的发货车间（权益全部读写 app_metadata）"""
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return
            app = user_res.user.app_metadata or {}
            current_id = UserService._get_current_contest_id()

            # 📦 逻辑 1：资源加油包 (addon) —— 只加额度
            if plan == "addon":
                app["booster_contest_id"] = current_id
                app.pop("has_bought_booster", None)
                current_flash = int(app.get("flash_left") if app.get("flash_left") is not None else 0)
                current_pro = int(app.get("pro_credits") if app.get("pro_credits") is not None else 0)
                app["flash_left"] = current_flash + 3
                app["pro_credits"] = current_pro + 2
                print(f"📦 用户 {user_id} 获得加油包：+3 Flash, +2 Pro。绑定赛事: {current_id}")

            # 🏆 逻辑 2：大奖赛门票/参赛费 (contestant)
            elif plan == "contestant":
                app["role"] = "contestant"
                app["paid_contest_id"] = current_id
                app.pop("is_paid", None)
                if app.get("booster_contest_id") != current_id:
                    current_flash = int(app.get("flash_left") if app.get("flash_left") is not None else 0)
                    current_pro = int(app.get("pro_credits") if app.get("pro_credits") is not None else 0)
                    app["flash_left"] = current_flash + 3
                    app["pro_credits"] = current_pro + 2
                    print(f"🏆 用户 {user_id} 报名【{current_id}】，发放初始资源：+3 Flash, +2 Pro。")
                else:
                    print(f"🏆 用户 {user_id} 报名【{current_id}】，本赛季已购包，不重复白送。")

            # ✨ 逻辑 3：年费专业版 (pro)
            elif plan == "pro":
                app["role"] = "pro"
                app.pop("is_paid", None)
                app.pop("has_bought_booster", None)
                expiry_date = datetime.now(timezone.utc) + timedelta(days=365)
                app["expiry_date"] = expiry_date.strftime('%Y-%m-%dT%H:%M:%SZ')
                app["flash_left"] = 9999
                app["pro_credits"] = 9999
                app["pro_daily_used"] = 0
                app["last_active_date"] = datetime.now().date().isoformat()
                print(f"✨ 用户 {user_id} 升级年费专业版，有效期至 {app['expiry_date']}")

            UserService._save_entitlements(user_id, app)
        except Exception as e:
            print(f"❌ 发货车间数据库写入失败: {e}")
            raise e

    @staticmethod
    def apply_free_contestant(user_id: str):
        """免费报名参赛（权益全部读写 app_metadata）"""
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return False, "用户不存在"
            app = user_res.user.app_metadata or {}
            current_id = UserService._get_current_contest_id()

            is_current_contestant = (app.get("role") == "contestant" and app.get("paid_contest_id") == current_id)
            is_pro = (app.get("role") == "pro")
            if is_pro or is_current_contestant:
                return True, "您已具备相应资格"

            app["role"] = "contestant"
            app["paid_contest_id"] = current_id
            app.pop("is_paid", None)

            if app.get("booster_contest_id") == current_id:
                print(f"⚠️ 用户 {user_id} 免费报名成功（本赛季已购包，不送资源）。")
            else:
                current_flash = int(app.get("flash_left") if app.get("flash_left") is not None else 0)
                current_pro = int(app.get("pro_credits") if app.get("pro_credits") is not None else 0)
                app["flash_left"] = current_flash + 3
                app["pro_credits"] = current_pro + 2
                print(f"🏆 用户 {user_id} 免费报名成功，获得资格及资源：+3 Flash, +2 Pro。")

            UserService._save_entitlements(user_id, app)
            return True, "报名成功"
        except Exception as e:
            print(f"❌ 免费报名车间执行崩溃: {e}")
            raise e
