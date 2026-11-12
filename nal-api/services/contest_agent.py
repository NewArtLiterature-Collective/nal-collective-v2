# services/contest_agent.py
import sys
import numpy as np
import asyncio
from services.user_service import supabase_admin
from services import storage_service as storage     # 参赛配图在 Cloudflare R2 私有桶
from services.contest_literary_service import ContestLiteraryService, VIOLATION_LABELS
import httpx
from io import BytesIO
from PIL import Image


async def download_image(url_or_path: str):
    """参赛配图下载器：从 Cloudflare R2 私有桶读取（2026-11 起取代 Supabase Storage）。
    数据库里可能是对象名，也可能是旧的 Supabase 完整网址，storage_service 会统一取出对象名。"""
    try:
        data = await asyncio.to_thread(storage.get_contest_image, url_or_path)
        return Image.open(BytesIO(data))
    except Exception as e:
        print(f"🚨 参赛配图读取失败 [{url_or_path}]: {e}")
    return None


def _build_block_message(content_safety: dict) -> str:
    """把内容安全命中结果拼成一段直接返回给用户的说明。"""
    vt = content_safety.get("violation_type", "")
    label = VIOLATION_LABELS.get(vt, vt or "内容安全")
    where = "插画" if content_safety.get("where") == "image" else "文本"
    evid = (content_safety.get("evidence") or "").strip()
    if vt == "platform_block":
        # 整本文字或插画被平台拦截：模型拒绝读取，无法评审（2026-11-09）
        return (f"⛔ 内容安全未通过：您提交的{where}未能通过平台的内容审核，无法进行评审。\n"
                f"依据大赛内容安全规定，本作品已停止评审、不予入围。\n"
                f"如您认为这是误判，请联系人工审核团队。")
    msg = (f"⛔ 内容安全未通过：系统在您提交的{where}中检测到不适合本平台的内容（{label}）。\n"
           f"依据大赛内容安全规定，本作品已停止评审、不予入围。")
    if evid:
        msg += f"\n参考依据：{evid}"
    msg += "\n如您认为这是误判，请联系人工审核团队。"
    return msg


async def contest_pipeline(submission_id: str):
    """
    NAL 大赛 Agent 流水线：竞争夺锁 -> 门槛校验 -> 内容安全闸 -> 三专家会诊 -> 计算争议 -> 入库
    """
    try:
        # 🚨 核心安全升级：原子夺锁机制
        lock_res = supabase_admin.table("contest_submissions") \
            .update({"status": "processing"}) \
            .eq("id", submission_id) \
            .eq("status", "pending") \
            .execute()

        if not lock_res.data:
            print(f"⏭️ 作品 {submission_id} 已被其他线程夺取或已完成，本流水线跳过。")
            return

        work = lock_res.data[0]

        text = work.get("text_content", "")
        images = work.get("image_urls", [])
        if images is None:
            images = []
        # 作者 AI 声明（当前库中可能尚无该字段，缺省视为未声明）
        # 投稿时写入的字段是 has_declared_ai（前端 / 投稿接口），旧字段名保留兼容
        has_declared_ai = bool(work.get("has_declared_ai") is True or work.get("ai_declaration") == "yes"
                               or work.get("ai_declared") is True)

        print(f"🛠️ [DEBUG] 正在校验作品 {submission_id[:8]} ... 字数: {len(text)}, 图片数: {len(images)}")

        # --- Agent A: Gatekeeper (门槛校验) ---
        if len(text) < 500 or len(images) < 1:
            error_detail = f"未达参赛门槛（系统检测到字数: {len(text)}, 图片数: {len(images)}）"
            await update_status(submission_id, "invalid", error_detail)
            return

        # 🚨 统一全异步下载图片资产
        download_tasks = [download_image(url) for url in images]
        pil_images = await asyncio.gather(*download_tasks)
        valid_images = [img for img in pil_images if img is not None]

        if not valid_images:
            await update_status(submission_id, "invalid", "参赛插画资产解析失败或链接失效")
            return

        # --- Agent A+: 内容安全 & AIGC 独立前置筛查（只扫一次）---
        screen = await ContestLiteraryService.screen_work(text, valid_images, has_declared_ai)

        # 🚫 内容违规 → 立即停止评审，把结果直接返回给用户
        if screen.get("content_blocked"):
            msg = _build_block_message(screen.get("content_safety") or {})
            supabase_admin.table("contest_submissions").update({
                "status": "content_blocked",
                "error_msg": msg,
                "ai_review": msg,
            }).eq("id", submission_id).execute()
            print(f"🚫 作品 {submission_id[:8]} 命中内容安全红线，已停止评审、不予入围。")
            return

        # ⏳ 内容审查未能完成（接口异常）→ 不评审、不放行，退回 pending，下一批自动重试
        if screen.get("screen_error"):
            detail = screen.get("screen_error_detail") or "内容审查暂时无法完成"
            await update_status(submission_id, "pending", f"内容审查未完成，等待重试：{detail}")
            print(f"⏳ 作品 {submission_id[:8]} 内容审查未完成，已退回待审，下一批重试。")
            return

        # --- Agent B: Evaluator (三专家会诊)；复用 screen，避免重复扫描；横幅由下方统一加一次 ---
        print(f"🧠 正在调用 AI 专家组进行多维度并发会诊: {submission_id[:8]}")

        tasks = [
            ContestLiteraryService.evaluate_contest_work(text, valid_images, "panoramic",
                                                         has_declared_ai=has_declared_ai, screen=screen, mark_ai=False),
            ContestLiteraryService.evaluate_contest_work(text, valid_images, "nal_chief",
                                                         has_declared_ai=has_declared_ai, screen=screen, mark_ai=False),
            ContestLiteraryService.evaluate_contest_work(text, valid_images, "li_lifang",
                                                         has_declared_ai=has_declared_ai, screen=screen, mark_ai=False),
        ]
        results = await asyncio.gather(*tasks)
        p_res, c_res, l_res = results[0], results[1], results[2]

        # ⏳ 任一专家评审失败（接口异常/JSON 受损）→ 不以 0 分入库，退回 pending，下一批重试
        failed = [r for r in results if r.get("status") != "reviewed"]
        if failed:
            await update_status(submission_id, "pending",
                                f"评审未完成，等待重试：{(failed[0].get('review') or '')[:200]}")
            print(f"⏳ 作品 {submission_id[:8]} 有 {len(failed)} 位专家评审失败，已退回待审，下一批重试。")
            return

        # 核心数学计算：汇总均分与离散度
        all_score_points = []
        combined_scores = {}
        for dim in p_res["scores"].keys():
            dim_vals = [p_res["scores"][dim], c_res["scores"][dim], l_res["scores"][dim]]
            combined_scores[dim] = float(np.mean(dim_vals))
            all_score_points.extend(dim_vals)

        ai_variance = float(np.var(all_score_points))
        ai_total_score = float(np.mean(all_score_points))

        final_review = (
            f"【全景视角】：{p_res['review']}\n\n"
            f"【首席锐评】：{c_res['review']}\n\n"
            f"【学术溯源】：{l_res['review']}"
        )

        # 🤖 未申明且有元数据硬证据 → 大赛口径：不拦、照评，在评语顶部统一标注一次
        #   （2026-11-09：只认元数据；文风/画面印象不构成证据）
        aigc = screen.get("aigc") or {}
        if screen.get("ai_flag"):
            evid = (aigc.get("evidence") or "").strip()
            banner = ("🤖【AI 生成证据 · 作者未申明】" + (evid or "图片元数据含 AI 生成工具特征")
                      + "；作者声明为纯人类原创。评分照常给出，须人工复核其 AI 使用情况。\n\n")
            final_review = banner + final_review
        else:
            # 模型找到的可指认破绽：只作人工参考，附在评语末尾，措辞中性
            ref = aigc.get("reference") or {}
            if (not has_declared_ai and ref.get("suspected") and ref.get("evidence")
                    and ref.get("confidence") in ("high", "medium")):
                final_review += f"\n\n🔎 AI 使用参考（仅供人工参考，不构成认定）：{ref['evidence']}"

        # ⚠️ 内容风险（非性内容）→ 不拦、照评，在评语最顶部统一提示一次，交人工复核
        risk_note = ContestLiteraryService.render_risks(screen.get("risks") or [])
        if risk_note:
            final_review = risk_note + final_review

        update_payload = {
            "status": "success",
            "ai_scores": combined_scores,
            "ai_total_score": ai_total_score,
            "ai_variance": ai_variance,
            "ai_review": final_review,
            "word_count": len(text),
        }
        supabase_admin.table("contest_submissions").update(update_payload).eq("id", submission_id).execute()

        print(f"✅ 会诊完成: {submission_id[:8]} (争议度: {ai_variance:.2f})")

    except Exception as e:
        print(f"🚨 流水线崩溃: {e}")
        await update_status(submission_id, "invalid", str(e))


async def update_status(sid, status, error=None):
    supabase_admin.table("contest_submissions").update({
        "status": status,
        "error_msg": error
    }).eq("id", sid).execute()


async def run_batch_review():
    """
    云端一次性批处理引擎 (Batch Job)
    由 FastAPI 前端按钮唤醒，拉取所有待审作品，评完立刻安全退出。
    """
    print("🚀 [NAL 离线评审引擎] 启动！正在扫描数据库...")

    try:
        res = supabase_admin.table("contest_submissions") \
            .select("id") \
            .eq("status", "pending") \
            .execute()

        pending_works = res.data

        if not pending_works:
            print("🏁 [NAL 离线评审引擎] 侦测到当前没有待评审的作品，任务结束。")
            return

        print(f"📊 发现 {len(pending_works)} 篇待评审作品，开始注入 AI 算力...")

        # 顺序送入流水线，防止 Gemini 429 限流并保护 Render 内存
        for index, work in enumerate(pending_works, 1):
            target_id = work['id']
            print(f"\n--- 正在处理第 {index}/{len(pending_works)} 篇 ---")
            await contest_pipeline(target_id)

        print("\n🎉 [NAL 离线评审引擎] 当前批次所有作品已全部处理完毕！")

    except Exception as e:
        print(f"🚨 批处理引擎发生致命错误: {e}")


if __name__ == "__main__":
    asyncio.run(run_batch_review())
