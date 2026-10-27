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
    # 🔒 role 权威来源 = app_metadata（仅 service_role 可写，用户改不了）
    #    额度/资料（flash_left/pro_credits/expiry/paid_contest_id/real_name…）仍在 user_metadata。
    #    下面这个内部写入器：一次把 user_metadata(额度) 和 app_metadata(role) 一起写回，
    #    role=None 表示“本次不动 role”，传 'free'/'contestant'/'pro' 则更新 role。
    # ==========================================================
    @staticmethod
    def _save(user_id: str, user_meta: dict, role=None, app_meta_existing: dict = None):
        attrs = {"user_metadata": user_meta}
        if role is not None:
            base = dict(app_meta_existing or {})
            base["role"] = role
            attrs["app_metadata"] = base
        supabase_admin.auth.admin.update_user_by_id(user_id, attrs)

    @staticmethod
    def _role_of(user) -> str:
        """统一从 app_metadata 读角色。"""
        try:
            return (user.app_metadata or {}).get("role")
        except Exception:
            return None

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
        """获取用户核心方法：注入动态过期自愈清洗（role 从 app_metadata 读、降级写 app_metadata）"""
        try:
            res = supabase_admin.auth.admin.get_user_by_id(user_id)
            if not res or not hasattr(res, 'user'):
                return res

            user = res.user
            meta = user.user_metadata or {}
            app_meta = user.app_metadata or {}
            role = app_meta.get("role")

            # 🚨 自然过期静默清洗自愈防线
            if role == "pro" and meta.get("expiry_date"):
                try:
                    expiry_dt = datetime.fromisoformat(meta.get("expiry_date"))
                    if datetime.now(timezone.utc) > expiry_dt:
                        print(f"⚠️ 发现过期 Pro 用户 {user_id}（到期: {meta.get('expiry_date')}），强制静默降级并清洗...")
                        meta["flash_left"] = 3
                        meta["pro_credits"] = 0
                        meta.pop("is_paid", None)
                        meta.pop("has_bought_booster", None)
                        meta.pop("role", None)  # 清掉可能残留的旧 user_metadata.role
                        # role 降级写 app_metadata
                        UserService._save(user_id, meta, role="free", app_meta_existing=app_meta)
                except Exception as ex:
                    print(f"🚨 自动化过期拦截校验失败: {ex}")

            return res
        except Exception as e:
            print(f"❌ 获取用户失败: {e}")
            return None

    @classmethod
    def update_user_metadata(cls, user_id: str, new_meta: dict):
        """
        覆盖写 user_metadata。若 new_meta 里带 'role'（历史调用习惯），自动把 role 迁出到
        app_metadata（权威来源），user_metadata 里不再保留 role。
        """
        new_meta = dict(new_meta or {})
        role = new_meta.pop("role", None)  # 不让 role 落在 user_metadata
        app_meta_existing = None
        if role is not None:
            try:
                res = supabase_admin.auth.admin.get_user_by_id(user_id)
                app_meta_existing = (res.user.app_metadata or {}) if res and hasattr(res, 'user') else {}
            except Exception:
                app_meta_existing = {}
        cls._save(user_id, new_meta, role=role, app_meta_existing=app_meta_existing)

    @staticmethod
    def upgrade_user_to_pro(user_id: str, plan: str = "contestant"):
        """支付回调后的发货车间（role 写 app_metadata，额度写 user_metadata）"""
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return
            meta = user_res.user.user_metadata or {}
            app_meta = user_res.user.app_metadata or {}
            new_role = None  # None = 不改 role

            current_id = UserService._get_current_contest_id()

            # 📦 逻辑 1：资源加油包 (addon) —— 只加额度，不动 role
            if plan == "addon":
                meta["booster_contest_id"] = current_id
                meta.pop("has_bought_booster", None)
                current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                meta["flash_left"] = current_flash + 3
                meta["pro_credits"] = current_pro + 2
                print(f"📦 用户 {user_id} 获得加油包：+3 Flash, +2 Pro。绑定赛事: {current_id}")

            # 🏆 逻辑 2：大奖赛门票/参赛费 (contestant)
            elif plan == "contestant":
                new_role = "contestant"
                meta["paid_contest_id"] = current_id
                meta.pop("is_paid", None)
                meta.pop("role", None)  # 清掉旧的 user_metadata.role
                if meta.get("booster_contest_id") != current_id:
                    current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                    current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                    meta["flash_left"] = current_flash + 3
                    meta["pro_credits"] = current_pro + 2
                    print(f"🏆 用户 {user_id} 报名【{current_id}】，发放初始资源：+3 Flash, +2 Pro。")
                else:
                    print(f"🏆 用户 {user_id} 报名【{current_id}】，本赛季已购包，不重复白送。")

            # ✨ 逻辑 3：年费专业版 (pro)
            elif plan == "pro":
                new_role = "pro"
                meta.pop("is_paid", None)
                meta.pop("has_bought_booster", None)
                meta.pop("role", None)
                expiry_date = datetime.now(timezone.utc) + timedelta(days=365)
                meta["expiry_date"] = expiry_date.strftime('%Y-%m-%dT%H:%M:%SZ')
                meta["flash_left"] = 9999
                meta["pro_credits"] = 9999
                meta["pro_daily_used"] = 0
                meta["last_active_date"] = datetime.now().date().isoformat()
                print(f"✨ 用户 {user_id} 升级年费专业版，有效期至 {meta['expiry_date']}")

            # 持久化：额度→user_metadata，role→app_metadata（一次写回）
            UserService._save(user_id, meta, role=new_role, app_meta_existing=app_meta)
        except Exception as e:
            print(f"❌ 发货车间数据库写入失败: {e}")
            raise e

    @staticmethod
    def apply_free_contestant(user_id: str):
        """免费报名参赛（role 写 app_metadata，额度写 user_metadata）"""
        try:
            user_res = UserService.get_user_by_id(user_id)
            if not user_res:
                return False, "用户不存在"
            meta = user_res.user.user_metadata or {}
            app_meta = user_res.user.app_metadata or {}
            current_role = app_meta.get("role")

            current_id = UserService._get_current_contest_id()

            is_current_contestant = (current_role == "contestant" and meta.get("paid_contest_id") == current_id)
            is_pro = (current_role == "pro")
            if is_pro or is_current_contestant:
                return True, "您已具备相应资格"

            meta["paid_contest_id"] = current_id
            meta.pop("is_paid", None)
            meta.pop("role", None)

            if meta.get("booster_contest_id") == current_id:
                print(f"⚠️ 用户 {user_id} 免费报名成功（本赛季已购包，不送资源）。")
            else:
                current_flash = int(meta.get("flash_left") if meta.get("flash_left") is not None else 0)
                current_pro = int(meta.get("pro_credits") if meta.get("pro_credits") is not None else 0)
                meta["flash_left"] = current_flash + 3
                meta["pro_credits"] = current_pro + 2
                print(f"🏆 用户 {user_id} 免费报名成功，获得资格及资源：+3 Flash, +2 Pro。")

            UserService._save(user_id, meta, role="contestant", app_meta_existing=app_meta)
            return True, "报名成功"
        except Exception as e:
            print(f"❌ 免费报名车间执行崩溃: {e}")
            raise e
