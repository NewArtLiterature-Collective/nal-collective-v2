#!/usr/bin/env python3
"""
把 Supabase Storage 里的文件搬到 Cloudflare R2（每个环境各跑一次：v2 后端里跑一次，生产后端里跑一次）。

搬什么：
  · contest_works（参赛配图） → R2 私有桶 contest_works/<对象名>；
    并把 contest_submissions.image_urls 里旧的 Supabase 完整网址统一改成对象名
  · showcase（陈伯吹新儿童文学绘本插画大赛厅展品） → R2 公开桶 showcase/<作品ID>/<页>.jpg（数据库不用改）
  · nal_images（日常评审的临时上传）不搬：评审报告已生成，这些图片之后不再使用；可用 --delete-source 清理

在 Render 对应后端的 Shell 里运行（Supabase 与 R2 的环境变量都已在该服务里）：
  python scripts/migrate_storage_to_r2.py --dry-run      # 先预演：只统计，不写入
  python scripts/migrate_storage_to_r2.py                # 正式搬迁（可重复运行，已搬过的自动跳过）
  python scripts/migrate_storage_to_r2.py --delete-source  # 确认网站一切正常后：删除 Supabase 里已搬走的文件和评审临时图片

参数：
  --dry-run        只统计，不写入
  --overwrite      R2 里已有同名文件也重新上传
  --delete-source  只做清理：删除 Supabase 中【已确认存在于 R2】的参赛图、展厅图，以及 nal_images 全部文件
"""
import os
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # 让脚本能找到 services/

from services.user_service import supabase_admin
from services import storage_service as storage

SB_CONTEST, SB_SHOWCASE, SB_EVAL = "contest_works", "showcase", "nal_images"


def sb_list_all(bucket: str, prefix: str = "") -> list:
    """递归列出 Supabase 桶里的全部文件路径（文件夹的 id 为空）。"""
    out, offset = [], 0
    while True:
        try:
            items = supabase_admin.storage.from_(bucket).list(prefix, {"limit": 1000, "offset": offset}) or []
        except Exception as e:
            print(f"   ⚠️ 无法列出 {bucket}/{prefix}: {e}")
            return out
        for it in items:
            name = it.get("name")
            if not name or name == ".emptyFolderPlaceholder":
                continue
            path = f"{prefix}/{name}" if prefix else name
            if it.get("id") is None:          # 文件夹
                out += sb_list_all(bucket, path)
            else:
                out.append(path)
        if len(items) < 1000:
            return out
        offset += 1000


def ctype_of(path: str) -> str:
    return "image/png" if path.lower().endswith(".png") else "image/jpeg"


def copy_bucket(sb_bucket: str, r2_bucket: str, r2_prefix: str, a) -> tuple:
    files = sb_list_all(sb_bucket)
    print(f"📦 Supabase {sb_bucket}：{len(files)} 个文件 → R2 {r2_bucket}/{r2_prefix}")
    copied = skipped = failed = 0
    for i, path in enumerate(files, 1):
        key = r2_prefix + path
        try:
            if not a.overwrite and storage.exists(r2_bucket, key):
                skipped += 1
                continue
            if a.dry_run:
                copied += 1
                continue
            data = supabase_admin.storage.from_(sb_bucket).download(path)
            storage.put(r2_bucket, key, data, ctype_of(path))
            copied += 1
            print(f"   {i}/{len(files)} ✓ {path}", end="\r")
        except Exception as e:
            failed += 1
            print(f"\n   ❌ {path}: {e}")
    print(f"   {'将复制' if a.dry_run else '已复制'} {copied}，已存在跳过 {skipped}，失败 {failed}            ")
    return copied, skipped, failed


def normalize_contest_urls(a) -> int:
    """contest_submissions.image_urls：旧的 Supabase 完整网址 → 对象名。"""
    rows = supabase_admin.table("contest_submissions").select("id, image_urls").execute().data or []
    changed = 0
    for r in rows:
        urls = r.get("image_urls") or []
        names = [storage.contest_object_name(u) for u in urls]
        if names != urls:
            changed += 1
            if not a.dry_run:
                supabase_admin.table("contest_submissions").update({"image_urls": names}).eq("id", r["id"]).execute()
    print(f"🗂️  参赛作品记录：{len(rows)} 条，{'需' if a.dry_run else '已'}把图片网址改为对象名 {changed} 条")
    return changed


def delete_source(a):
    print("🧹 清理 Supabase 中已搬到 R2 的文件")
    for sb_bucket, r2_bucket, r2_prefix in ((SB_CONTEST, storage.private_bucket(), storage.CONTEST_PREFIX),
                                            (SB_SHOWCASE, storage.public_bucket(), storage.SHOWCASE_PREFIX)):
        files = sb_list_all(sb_bucket)
        safe = [p for p in files if storage.exists(r2_bucket, r2_prefix + p)]
        missing = len(files) - len(safe)
        print(f"   {sb_bucket}：{len(files)} 个，R2 已确认 {len(safe)} 个{f'，⚠️ {missing} 个未在 R2 找到，保留不删' if missing else ''}")
        if not a.dry_run:
            for i in range(0, len(safe), 100):
                supabase_admin.storage.from_(sb_bucket).remove(safe[i:i + 100])
    evals = sb_list_all(SB_EVAL)
    print(f"   {SB_EVAL}（评审临时图片，不搬迁）：{len(evals)} 个{'，将删除' if a.dry_run else '，已删除'}")
    if not a.dry_run:
        for i in range(0, len(evals), 100):
            supabase_admin.storage.from_(SB_EVAL).remove(evals[i:i + 100])


def main():
    ap = argparse.ArgumentParser(description="Supabase Storage → Cloudflare R2")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--delete-source", action="store_true")
    a = ap.parse_args()

    try:
        print(f"R2 私有桶：{storage.private_bucket()}　公开桶：{storage.public_bucket()}")
        storage.list_keys(storage.private_bucket(), "__probe__/")
        storage.list_keys(storage.public_bucket(), "__probe__/")
        print("✅ R2 连接正常\n")
    except Exception as e:
        sys.exit(f"❌ 无法连接 R2：{e}\n   请检查本服务的 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / 桶名")

    if a.delete_source:
        delete_source(a)
        print("\n（预演，未删除）" if a.dry_run else "\n清理完成。")
        return

    c1 = copy_bucket(SB_CONTEST, storage.private_bucket(), storage.CONTEST_PREFIX, a)
    c2 = copy_bucket(SB_SHOWCASE, storage.public_bucket(), storage.SHOWCASE_PREFIX, a)
    normalize_contest_urls(a)
    failed = c1[2] + c2[2]
    print(f"\n{'（预演，未写入）' if a.dry_run else ''}完成。{'有失败项，可直接重跑本脚本（已复制的会跳过）。' if failed else ''}")


if __name__ == "__main__":
    main()
