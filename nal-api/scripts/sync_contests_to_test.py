#!/usr/bin/env python3
"""
把生产库的赛事信息同步到测试库（v2）。

同步内容：
  · contests 表全部赛事（名称、章程、截稿与展厅时间等，保持原 ID）—— 测试库已有同 ID 的赛事会被更新为生产的内容
  · 加 --set-current：测试库的 site_settings 也指向生产的当前赛事，并同步"投稿大闸"开关
不同步：参赛作品、报名信息、用户、付款等任何个人数据。

推荐在 Render 上【生产后端 nal-api-production】的 Shell 里运行：
  生产库（源）的地址和密钥已在本服务环境变量里，只需临时提供测试库（目标）的地址和 service_role 密钥：

  export DST_URL=https://huyipckqstwwwtzeyygx.supabase.co
  export DST_SERVICE_KEY=<v2 的 service_role 密钥>
  python scripts/sync_contests_to_test.py --dry-run          # 预演
  python scripts/sync_contests_to_test.py --set-current      # 同步赛事，并让 v2 指向同一当前赛事

参数：
  --dry-run       只列出，不写入
  --set-current   同时把测试库的 current_contest_id 与 is_contest_active 设为与生产相同
"""
import os
import sys
import argparse
from supabase import create_client


def env(name, fallback=None):
    v = os.getenv(name) or (os.getenv(fallback) if fallback else None)
    v = "".join((v or "").split()).strip("'\"")   # 去掉复制时带进的空格、换行、引号
    if not v:
        sys.exit(f"❌ 缺少环境变量 {name}" + (f"（或 {fallback}）" if fallback else ""))
    return v


def upsert(dst, table, row, conflict="id"):
    """写入一条；目标库缺少某字段时去掉该字段重试并提示。"""
    row = dict(row)
    for _ in range(8):
        try:
            dst.table(table).upsert(row, on_conflict=conflict).execute()
            return
        except Exception as e:
            msg = str(e)
            missing = next((c for c in list(row) if f"'{c}'" in msg and ("column" in msg or "PGRST204" in msg)), None)
            if not missing or missing == conflict:
                raise
            print(f"   ⚠️ 测试库 {table} 没有字段 {missing}，已跳过该字段")
            row.pop(missing)
    raise RuntimeError("写入失败：字段不匹配次数过多")


def main():
    ap = argparse.ArgumentParser(description="生产 → 测试：同步赛事信息")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--set-current", action="store_true")
    a = ap.parse_args()

    src_url, src_key = env("SRC_URL", "SUPABASE_URL"), env("SRC_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY")
    dst_url, dst_key = env("DST_URL"), env("DST_SERVICE_KEY")
    if src_url.rstrip("/") == dst_url.rstrip("/"):
        sys.exit("❌ 源库和目标库是同一个项目，请检查 DST_URL")
    print(f"源（生产）：{src_url}\n目标（测试）：{dst_url}\n")

    src, dst = create_client(src_url, src_key), create_client(dst_url, dst_key)
    for label, cli in (("源库（生产）", src), ("目标库（测试）", dst)):
        try:
            cli.table("contests").select("id").limit(1).execute()
        except Exception as e:
            sys.exit(f"❌ 无法读取{label}：{e}")
    print("✅ 两边连接正常\n")

    contests = src.table("contests").select("*").execute().data or []
    existing = {r["id"] for r in (dst.table("contests").select("id").execute().data or [])}
    print(f"生产共 {len(contests)} 届赛事；测试库已有 {len(existing)} 届。")
    for c in contests:
        tag = "更新" if c["id"] in existing else "新增"
        print(f"  {tag}：{c.get('name')}（{c['id']}）截稿 {str(c.get('submission_deadline') or '未设')[:10]}")
        if not a.dry_run:
            upsert(dst, "contests", c)

    if a.set_current:
        s = (src.table("site_settings").select("current_contest_id, is_contest_active").eq("id", 1).execute().data or [{}])[0]
        print(f"\n测试库当前赛事 → {s.get('current_contest_id')}，投稿大闸 → {'开启' if s.get('is_contest_active') else '关闭'}")
        if not a.dry_run:
            upsert(dst, "site_settings", {"id": 1, "current_contest_id": s.get("current_contest_id"),
                                          "is_contest_active": bool(s.get("is_contest_active"))})

    print(f"\n{'（预演，未写入）' if a.dry_run else ''}完成。")


if __name__ == "__main__":
    main()
