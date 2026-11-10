#!/usr/bin/env python3
"""
把陈伯吹新儿童文学绘本插画大赛厅的展品，从 v2（调试库）复制到生产库。

复制内容：showcase_works 表的记录（保持原 ID、届次、标题、判词、排序、发布状态、水印标记）
          + showcase 存储桶里对应的全部图片（保持原路径）。
不会删除或修改 v2 上的任何东西；生产库里已存在的同 ID 作品默认跳过（--overwrite 才覆盖）。

推荐在 Render 上【生产后端 nal-api-production】的 Shell 里运行：
  生产库的地址和密钥已在环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 里，
  只需临时提供 v2 的地址和 service_role 密钥（在 Shell 里输入，不要贴到聊天或提交到代码里）：

  cd nal-api   # Render Shell 若已在 nal-api 目录可省略
  SRC_URL=https://<v2项目>.supabase.co SRC_SERVICE_KEY=<v2的service_role密钥> \
      python scripts/migrate_showcase.py --dry-run        # 先预演：只列出要复制什么
  SRC_URL=... SRC_SERVICE_KEY=... python scripts/migrate_showcase.py   # 正式复制

可选参数：
  --dry-run       只列出，不写入
  --overwrite     生产库已有同 ID 作品时覆盖（默认跳过）
  --unpublish     复制到生产后一律设为"未发布"，确认无误后再到后台逐件发布
  --only-published 只复制 v2 上已发布的作品
"""
import os
import sys
import argparse
from supabase import create_client

BUCKET = "showcase"
TABLE = "showcase_works"


def env(name, fallback=None):
    v = os.getenv(name) or (os.getenv(fallback) if fallback else None)
    if not v:
        sys.exit(f"❌ 缺少环境变量 {name}" + (f"（或 {fallback}）" if fallback else ""))
    return v


def insert_row(dst, row, overwrite):
    """写入一条记录；生产库若缺少某些新字段（例如还没运行 watermark SQL），去掉该字段重试并提示。"""
    row = dict(row)
    for _ in range(6):
        try:
            q = dst.table(TABLE)
            (q.upsert(row, on_conflict="id") if overwrite else q.insert(row)).execute()
            return
        except Exception as e:
            msg = str(e)
            missing = next((c for c in list(row) if f"'{c}'" in msg and ("column" in msg or "PGRST204" in msg)), None)
            if not missing or missing in ("id", "title", "category", "pages"):
                raise
            print(f"   ⚠️ 生产库没有字段 {missing}，已跳过该字段（建议补跑对应 SQL）")
            row.pop(missing)
    raise RuntimeError("写入失败：字段不匹配次数过多")


def main():
    ap = argparse.ArgumentParser(description="复制绘本插画大赛厅展品：v2 → 生产")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--unpublish", action="store_true")
    ap.add_argument("--only-published", action="store_true")
    a = ap.parse_args()

    src_url, src_key = env("SRC_URL"), env("SRC_SERVICE_KEY")
    dst_url, dst_key = env("DST_URL", "SUPABASE_URL"), env("DST_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY")
    if src_url.rstrip("/") == dst_url.rstrip("/"):
        sys.exit("❌ 源库和目标库是同一个项目，请检查 SRC_URL")
    print(f"源（v2）  ：{src_url}\n目标（生产）：{dst_url}\n")

    src, dst = create_client(src_url, src_key), create_client(dst_url, dst_key)

    q = src.table(TABLE).select("*").order("category").order("sort_order", desc=True)
    if a.only_published:
        q = q.eq("is_published", True)
    works = q.execute().data or []
    existing = {r["id"] for r in (dst.table(TABLE).select("id").execute().data or [])}
    print(f"v2 共 {len(works)} 件作品；生产库已有 {len(existing)} 件。\n")

    done = skipped = failed = 0
    for w in works:
        name = f"[{'绘本' if w.get('category') == 'picturebook' else '插画'}] {w.get('edition') or ''}《{w.get('title')}》"
        pages = w.get("pages") or []
        if w["id"] in existing and not a.overwrite:
            print(f"⏭️  {name} —— 生产库已存在，跳过")
            skipped += 1
            continue
        flag = "" if w.get("watermarked", True) else "（⚠️ v2 上标记为未加水印）"
        print(f"📦 {name}：{len(pages)} 张图{flag}")
        if a.dry_run:
            continue
        try:
            for i, path in enumerate(pages, 1):
                data = src.storage.from_(BUCKET).download(path)
                ctype = "image/png" if path.lower().endswith(".png") else "image/jpeg"
                dst.storage.from_(BUCKET).upload(path, data, {"content-type": ctype, "upsert": "true"})
                print(f"   图 {i}/{len(pages)} ✓", end="\r")
            row = {k: v for k, v in w.items()}
            if a.unpublish:
                row["is_published"] = False
            insert_row(dst, row, a.overwrite)
            print(f"   ✅ 已复制（{len(pages)} 张图）{'，设为未发布' if a.unpublish else ''}        ")
            done += 1
        except Exception as e:
            print(f"   ❌ 失败：{e}")
            failed += 1

    print(f"\n{'（预演，未写入）' if a.dry_run else ''}完成：复制 {done} 件，跳过 {skipped} 件，失败 {failed} 件。")
    if failed:
        print("失败的作品可以直接重跑本脚本（已成功的会自动跳过）。")


if __name__ == "__main__":
    main()
