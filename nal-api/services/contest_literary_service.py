# services/contest_literary_service.py
import json
from core.config import settings
from google import genai
from google.genai import types

client = genai.Client()

# 预检用快模型（确定性）；评审仍用 Pro
SCREEN_MODEL = "gemini-2.5-flash"
REVIEW_MODEL = "gemini-2.5-pro"

# 内容安全分块参数：违规是局部的，必须全文覆盖
SAFETY_CHUNK_SIZE = 12000
SAFETY_CHUNK_OVERLAP = 600

AI_KEYWORDS = [
    'stable diffusion', 'midjourney', 'dall-e', 'dall·e',
    'comfyui', 'automatic1111', 'novelai', 'parameters',
    'cfg scale', 'sampler', 'steps:', 'lora', 'controlnet',
    'dreamshaper', 'invokeai', 'leonardo.ai', 'sdxl', 'swinir'
]

VIOLATION_LABELS = {
    "sexual_content": "性暗示或性描写内容",
    "gore_violence": "写实猎奇的血腥暴力或肢体残缺",
    "hate_symbol": "仇恨言论或极端主义内容",
    "self_harm": "自残或自杀的具象描绘",
}

SCORE_DIMS = ["文学底色", "叙事创新", "时代感", "感官对位"]

# ===== 统一内容安全口径（与在线文字/视觉、离线 lit/pb/illus 同一套：情节功能性 vs 猎奇渲染）=====
_TEXT_SAFETY_SYS = """你是一个内容安全审核系统，服务于一个儿童文学评奖平台。你的唯一任务是判断文本片段是否包含违规内容，不做任何文学评价。

⚠️核心原则：这是儿童／少年文学平台。少年冒险、科幻、历险题材中，打斗、追逐、营救、受伤、流血、死亡等情节是正常组成部分，绝不能因为出现“血/武器/打斗/受伤”就拦截。真正要拦的，是【为感官刺激／猎奇而写实、具象、细节化地渲染】的内容，而非【推动剧情、点到为止】的情节性内容。判断前先问：这段文字是在“讲一件事”，还是在“细细描摹血腥／性／残忍本身让人感官不适”？只有后者才拦。

【需要拦截——必须“写实+具象+为渲染而渲染”三者同时成立】
1. sexual_content：色情或性行为的具体过程描写；针对未成年人的任何性暗示或性化描写。（成人间点到为止的亲密、拥抱、亲吻不拦。）
2. gore_violence：以感官刺激为目的、细节化地描摹血腥、肢体残缺、内脏、尸体；或细致刻画并渲染酷刑、虐待、折磨过程。
3. hate_symbol：仇恨言论、极端主义或种族歧视煽动。
4. self_harm：自残或自杀的具体方法、步骤、过程的详细描写。

【放行（儿童／少年文学正常范畴）】情节功能性的暴力与受伤（打斗被打倒、流血、晕倒、受伤、骨折、营救擦伤、捆绑勒痕、淤青、血痂、疤痕，一笔带过服务剧情的“血流如注/瘫倒在地”）；死亡离别（含直接写到有人死去）；战争冲突、少年历险的打斗追逐逃亡；神怪恐怖氛围——只要不是以猎奇为目的细写血腥本身。

只要犹豫或介于两者之间 → 一律不拦。本平台绝大多数稿件都应判为不违规。
只输出纯 JSON：命中→{"content_violation": true, "violation_type": "...", "evidence": "20字内原文"}；未命中→{"content_violation": false}"""

_IMG_SAFETY_SYS = """你是一个内容安全审核系统，服务于一个儿童文学（绘本/插画）评奖平台。你的唯一任务是判断图片是否包含违规内容，不做任何艺术评价。

⚠️核心原则：这是儿童／少年文学平台。少年冒险、科幻、历险、神话题材的插画中，危险、打斗、营救、受伤、流血、死亡等画面是正常组成部分，绝不能因为画面里出现“血/武器/打斗/受伤”就拦截。真正要拦的，是【为感官刺激／猎奇而写实、具象、细节化地呈现】的画面，而非【服务于叙事、点到为止】的情节性画面。

【需要拦截——必须“写实+具象+为渲染而渲染”三者同时成立】
1. sexual_content：色情或性行为的描绘；针对未成年人的任何性暗示或性化呈现。
2. gore_violence：以猎奇为目的、写实而细致地呈现的血腥、肢体残缺、内脏、尸体；细致刻画并渲染酷刑/虐待/折磨的画面。
3. hate_symbol：纳粹标志等仇恨符号、极端主义视觉符号。
4. self_harm：自残或自杀的具象、写实描绘。

【放行】拥抱、亲吻脸颊、牵手等温情；无性意味的人体/雕塑/低幼裸体（洗澡、婴儿）；死亡离别的画面；战争冲突、少年历险的打斗追逐营救；情节功能性的受伤、流血、包扎、淤青、捆绑勒痕、刀剑/枪等武器；神怪恐怖氛围——只要不是以猎奇为目的细写血腥本身。

只要犹豫或介于两者之间 → 一律不拦。本平台绝大多数作品都应判为不违规。
只输出纯 JSON：命中→{"content_violation": true, "violation_type": "...", "evidence": "20字内描述最越界处"}；未命中→{"content_violation": false}"""

_AIGC_SYS = """你是 AIGC 鉴定员，服务于儿童文学评奖平台，只做 AI 生成痕迹鉴定，不评价艺术质量。
综合判断本作品（文本+插画）是否为 AI 生成或深度 AI 代写/生成：
- 文本：是否几乎每章结尾都用短句强行升华、情感靠直接宣告、结构算法式工整、模板化收尾过渡句——这类贯穿全文的结构性模型腔。注意：有生动细节不能洗白（当代 AI 完全能生成细节）。
- 画面：是否呈现 Midjourney/SD 等生成特征——无逻辑背景融合、过度均质的塑料光影、手部/结构崩坏、细节逻辑错乱却整体“过度完美”。注意：画得好、风格统一不等于 AI。
门槛要稳：只有证据明确、贯穿全篇时才给 confidence=high；个别段落/单图可疑至多 medium。
只输出纯 JSON（confidence 只填英文小写 high/medium/low）：
{"ai_suspected": true, "confidence": "high", "evidence": "40字内，点名文本或画面的关键依据"}"""


class ContestLiteraryService:

    # ---------- 工具 ----------
    @staticmethod
    def _norm_conf(v) -> str:
        s = str(v if v is not None else "").strip().lower()
        if "high" in s or "高" in s or "强" in s:
            return "high"
        if "medium" in s or "mid" in s or "中" in s:
            return "medium"
        return "low"

    @staticmethod
    def _affirm(v) -> bool:
        if isinstance(v, bool):
            return v
        return str(v if v is not None else "").strip().lower() in (
            "true", "yes", "y", "1", "是", "存在", "疑似", "确认"
        )

    @staticmethod
    def _chunk_text(text: str):
        text = text or ""
        if not text.strip():
            return []
        if len(text) <= SAFETY_CHUNK_SIZE:
            return [text]
        step = max(1, SAFETY_CHUNK_SIZE - SAFETY_CHUNK_OVERLAP)
        chunks, i = [], 0
        while i < len(text):
            chunks.append(text[i:i + SAFETY_CHUNK_SIZE])
            if i + SAFETY_CHUNK_SIZE >= len(text):
                break
            i += step
        return chunks

    @staticmethod
    def _load_json(resp):
        if not getattr(resp, "text", None):
            # 无文本 = 可能触发底层安全过滤，视作强风险信号
            raise ValueError("模型未返回文本（疑似触发底层内容安全机制）")
        data = json.loads(resp.text)
        if isinstance(data, list):
            data = data[0] if data else {}
        if not isinstance(data, dict):
            return {}
        return data

    @staticmethod
    def _extract_ai_fingerprint_from_pil(img) -> str:
        """在入库前，深度扫描 PIL 对象的深层元数据与生成参数。"""
        meta_text = ""
        try:
            if hasattr(img, 'text') and img.text:
                for k, v in img.text.items():
                    meta_text += f"{k}:{v}\n".lower()
            if hasattr(img, 'info') and img.info:
                for k, v in img.info.items():
                    if k != 'exif':
                        meta_text += f"{k}:{v}\n".lower()
            if hasattr(img, 'getexif'):
                exif = img.getexif()
                if exif:
                    for tag_id, value in exif.items():
                        if isinstance(value, bytes):
                            try:
                                meta_text += value.decode('utf-8', errors='ignore').lower() + "\n"
                            except Exception:
                                pass
                        else:
                            meta_text += str(value).lower() + "\n"
            for kw in AI_KEYWORDS:
                if kw in meta_text:
                    return kw
        except Exception:
            pass
        return ""

    # ---------- 独立前置：内容安全（文本分块 + 图像）----------
    @classmethod
    async def _scan_text_safety(cls, text: str) -> dict:
        chunks = cls._chunk_text(text)
        if not chunks:
            return {"content_violation": False}
        for idx, chunk in enumerate(chunks):
            try:
                resp = await client.aio.models.generate_content(
                    model=SCREEN_MODEL,
                    contents=[f"【待审查文本片段 {idx + 1}/{len(chunks)}】：\n{chunk}"],
                    config=types.GenerateContentConfig(
                        system_instruction=_TEXT_SAFETY_SYS,
                        temperature=0.0, response_mime_type="application/json",
                    ),
                )
                data = cls._load_json(resp)
                if data.get("content_violation"):
                    data["where"] = "text"
                    return data
            except Exception as e:
                # 单块抖动默认放行该块，其余块继续（不因一次异常误伤真人作品）
                print(f"⚠️ 文本内容安全第 {idx + 1} 块降级放行: {e}")
                continue
        return {"content_violation": False}

    @classmethod
    async def _scan_image_safety(cls, pil_images: list) -> dict:
        if not pil_images:
            return {"content_violation": False}
        try:
            resp = await client.aio.models.generate_content(
                model=SCREEN_MODEL,
                contents=["请审查以下所有图片是否包含违规内容："] + pil_images,
                config=types.GenerateContentConfig(
                    system_instruction=_IMG_SAFETY_SYS,
                    temperature=0.0, response_mime_type="application/json",
                ),
            )
            data = cls._load_json(resp)
            if data.get("content_violation"):
                data["where"] = "image"
                return data
            return {"content_violation": False}
        except Exception as e:
            # 图像扫描异常本身是风险信号，但大赛口径下保守交由评审横幅标注、不强拦；默认放行记录
            print(f"⚠️ 图像内容安全扫描降级放行: {e}")
            return {"content_violation": False, "scan_error": True}

    # ---------- 独立前置：AIGC 鉴定（元数据硬证据 + 文本/画面判断）----------
    @classmethod
    async def _scan_aigc(cls, text: str, pil_images: list) -> dict:
        # 1) 元数据指纹：硬证据
        meta_fp = ""
        for img in pil_images or []:
            fp = cls._extract_ai_fingerprint_from_pil(img)
            if fp:
                meta_fp = fp
                break
        # 2) 文本+画面综合判断
        suspected, conf, evid = False, "low", ""
        try:
            contents = [f"【待鉴定文本】：\n{(text or '')[:40000]}"] + (pil_images or [])
            resp = await client.aio.models.generate_content(
                model=SCREEN_MODEL, contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=_AIGC_SYS,
                    temperature=0.0, response_mime_type="application/json",
                ),
            )
            data = cls._load_json(resp)
            suspected = cls._affirm(data.get("ai_suspected"))
            conf = cls._norm_conf(data.get("confidence"))
            evid = (data.get("evidence") or "").strip()
        except Exception as e:
            print(f"⚠️ AIGC 鉴定降级: {e}")
        # 元数据命中即硬性高置信
        if meta_fp:
            suspected = True
            conf = "high"
            evid = (f"图片元数据含 AI 工具特征（{meta_fp}）；" + evid).strip("；")
        return {"suspected": suspected, "confidence": conf, "evidence": evid, "meta_fingerprint": meta_fp}

    # ---------- 可被调用方单独调用的"一次性筛查"（推荐在 persona 循环前跑一次）----------
    @classmethod
    async def screen_work(cls, text: str, pil_images: list, has_declared_ai: bool = False) -> dict:
        """内容安全 + AIGC 独立前置筛查。返回供调用方决定是否入围/是否标注。"""
        t_safe = await cls._scan_text_safety(text)
        i_safe = await cls._scan_image_safety(pil_images)
        hit = t_safe if t_safe.get("content_violation") else (i_safe if i_safe.get("content_violation") else None)

        aigc = await cls._scan_aigc(text, pil_images)
        # 未申明却检测到 AI → 打标（大赛口径：不拦，照评但显著标注）
        ai_flag = bool(aigc.get("suspected")) and not has_declared_ai

        return {
            "content_blocked": bool(hit),
            "content_safety": hit or {"content_violation": False},
            "aigc": aigc,
            "ai_declared": bool(has_declared_ai),
            "ai_flag": ai_flag,
        }

    @staticmethod
    def _blocked_result(screen: dict) -> dict:
        cs = screen.get("content_safety") or {}
        vt = cs.get("violation_type", "")
        label = VIOLATION_LABELS.get(vt, vt or "内容安全")
        where = "插画" if cs.get("where") == "image" else "文本"
        evid = (cs.get("evidence") or "").strip()
        return {
            "status": "content_blocked",
            "content_blocked": True,
            "scores": {d: 0 for d in SCORE_DIMS},
            "review": (f"⛔ 内容安全未通过：在{where}中检测到不适合本平台的内容（{label}）。"
                       f"依据大赛内容安全规定，本作品不予入围、不进入后期评审。"
                       + (f"\n证据：{evid}" if evid else "")),
            "ai_probability": 0,
            "content_safety": cs,
        }

    @staticmethod
    def _ai_prob_from(aigc: dict) -> int:
        return {"high": 95, "medium": 55, "low": 10}.get(aigc.get("confidence", "low"), 10)

    # ---------- 评审 ----------
    @staticmethod
    async def evaluate_contest_work(text: str, pil_images: list, persona: str = "panoramic",
                                    has_declared_ai: bool = False, screen: dict = None,
                                    mark_ai: bool = True):
        """
        多模态会诊（文本+插画）。内容安全与 AIGC 已改为独立前置：
        · 内容违规 → 不予入围、不评审（返回 content_blocked，供批处理记录/直接返回用户）。
        · 未申明却检测到 AI → 不拦，照常评审，结果显著标注（大赛口径）。
        调用方可在 persona 循环前调用 screen_work() 一次，并把结果作为 screen= 传入以复用，避免重复扫描。
        mark_ai=False 时本次不在单条评语顶部加 AIGC 横幅（由调用方在合并评语处统一加一次）。
        """
        cls = ContestLiteraryService
        # 1) 独立前置筛查（未传入则自行跑一遍，保证单独调用也安全）
        if screen is None:
            screen = await cls.screen_work(text, pil_images, has_declared_ai)

        # 2) 内容违规 → 不予入围、不进入评审
        if screen.get("content_blocked"):
            return cls._blocked_result(screen)

        aigc = screen.get("aigc") or {}
        ai_flag = bool(screen.get("ai_flag"))

        # 3) 评审提示词（已剥离自纠察红线；内容安全/AI 鉴定已在前置完成）
        base = ("（内容安全与 AI 鉴定已在评审前由独立环节完成，此处无需再做，专注评审即可。）\n"
                "🚨【绝对指令】：打分必须采用严格的百分制（0-100 的整数）。\n")
        prompts = {
            "panoramic": (
                "你是资深编辑，关注结构与图文绝对对位。你现在能同时看到故事文本和配套插画。\n"
                + base +
                "请评估画面视觉张力与文本互文结构，给出四个维度的打分和 80 字以内总结。"
            ),
            "nal_chief": (
                "你是首席专家，严厉打击“人造儿童”。你现在能同时看到故事文本和配套插画。\n"
                + base +
                "重点寻找插画与文字配合时的先锋性和实验性。评语要犀利，若有艺术灵性请破格给高分。"
            ),
            "li_lifang": (
                "你是学术专家，基于李利芳儿童精神理论。你现在能同时看到故事文本和配套插画。\n"
                + base +
                "考察图文结合后展现出的儿童本体深度。评语要深邃。"
            ),
        }
        system_instruction = prompts.get(persona, prompts["panoramic"])
        system_instruction += ("\n\n请务必只返回标准 JSON："
                               '{"scores": {"文学底色": 0, "叙事创新": 0, "时代感": 0, "感官对位": 0}, "review": "..."}')

        config = types.GenerateContentConfig(
            temperature=0.3, top_p=0.95, top_k=40,
            system_instruction=system_instruction,
            response_mime_type="application/json",
        )

        try:
            contents = [text] + (pil_images or [])
            response = await client.aio.models.generate_content(
                model=REVIEW_MODEL, contents=contents, config=config
            )
            result_json = cls._load_json(response)
        except json.JSONDecodeError as je:
            return {"status": "error", "content_blocked": False,
                    "scores": {d: 0 for d in SCORE_DIMS},
                    "review": f"返回的 JSON 结构受损: {je}", "ai_probability": cls._ai_prob_from(aigc),
                    "ai_flag": ai_flag, "aigc": aigc, "ai_declared": bool(has_declared_ai)}
        except Exception as e:
            return {"status": "error", "content_blocked": False,
                    "scores": {d: 0 for d in SCORE_DIMS},
                    "review": f"评审环节出现异常: {e}", "ai_probability": cls._ai_prob_from(aigc),
                    "ai_flag": ai_flag, "aigc": aigc, "ai_declared": bool(has_declared_ai)}

        scores = result_json.get("scores") or {d: 0 for d in SCORE_DIMS}
        review = (result_json.get("review") or "").strip()

        # 4) 未申明却检测到 AI → 评语顶部显著标注（不扣分、不拦，大赛口径）
        if ai_flag and mark_ai:
            evid = (aigc.get("evidence") or "").strip()
            banner = ("🤖【AIGC 嫌疑 · 作者未申明】本作品检测到明显的 AI 生成/代写痕迹，"
                      "但作者声明为纯人类原创。评分正常给出，须人工复核其 AI 使用情况。"
                      + (f"\n鉴定依据：{evid}\n\n" if evid else "\n\n"))
            review = banner + review

        return {
            "status": "reviewed",
            "content_blocked": False,
            "scores": scores,
            "review": review,
            "ai_probability": cls._ai_prob_from(aigc),
            "ai_flag": ai_flag,
            "aigc": aigc,
            "ai_declared": bool(has_declared_ai),
        }
