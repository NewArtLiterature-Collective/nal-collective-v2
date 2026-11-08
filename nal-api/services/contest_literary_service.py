# services/contest_literary_service.py
import os
import json
import asyncio
from core.config import settings
from google import genai
from google.genai import types

client = genai.Client()

# ===== 模型（2026-11 迁移到 Gemini 3.8 Flash）=====
# gemini-2.5-flash / 2.5-pro 于 2026-12-01 停用。写法 "模型名@思考档位"：
#   带档位 → 设 thinking_level，并去掉 temperature/top_p/top_k（3.8 不接受采样参数）
#   不带档位（如 gemini-3.1-pro-preview）→ 照旧传采样参数
# 可用环境变量覆盖，便于试跑对照。
SCREEN_MODEL = os.getenv("NAL_CONTEST_SCREEN_MODEL", "gemini-3.8-flash@low")     # 预检：内容安全、AIGC 鉴定
REVIEW_MODEL = os.getenv("NAL_CONTEST_REVIEW_MODEL", "gemini-3.8-flash@medium")  # 评审

# 旧模型名兜底：若别处仍传旧名，自动换成新模型
LEGACY_MODEL_MAP = {
    "gemini-2.5-flash": "gemini-3.8-flash@low",
    "gemini-2.5-pro": "gemini-3.8-flash@medium",
}
_SAMPLING_KEYS = ("temperature", "top_p", "top_k")


def resolve_model(spec: str):
    """"gemini-3.8-flash@low" → ("gemini-3.8-flash", "low")；旧名先按 LEGACY_MODEL_MAP 换成新模型。"""
    spec = LEGACY_MODEL_MAP.get(str(spec).strip(), str(spec).strip())
    name, _, level = spec.partition("@")
    return name.strip(), (level.strip().lower() or None)


async def _generate(spec: str, contents, system_instruction: str = None, **cfg):
    """统一的异步 JSON 调用：带思考档位的设 thinking_level、去掉采样参数；不带的照旧。"""
    name, level = resolve_model(spec)
    kw = dict(cfg)
    kw["system_instruction"] = system_instruction
    kw["response_mime_type"] = "application/json"
    if level:
        for k in _SAMPLING_KEYS:
            kw.pop(k, None)
        kw["thinking_config"] = types.ThinkingConfig(thinking_level=level)
    return await client.aio.models.generate_content(
        model=name, contents=contents, config=types.GenerateContentConfig(**kw))

# 内容安全分块参数：违规是局部的，必须全文覆盖
SAFETY_CHUNK_SIZE = 12000
SAFETY_CHUNK_OVERLAP = 600

AI_KEYWORDS = [
    'stable diffusion', 'midjourney', 'dall-e', 'dall·e',
    'comfyui', 'automatic1111', 'novelai', 'parameters',
    'cfg scale', 'sampler', 'steps:', 'lora', 'controlnet',
    'dreamshaper', 'invokeai', 'leonardo.ai', 'sdxl'
    # swinir 已移除：它是超分辨率放大工具，真人作品放大后也会带这个标记，不能作为 AI 生成的证据
]

# 只有这一类拦截（不予入围、不进入评审）；其余敏感内容写成“内容风险提示”，照常评审、交人工复核
# 与 v2 在线视觉评审（vision_llm_service）同一口径
VIOLATION_LABELS = {
    "sexual_content": "色情性行为描写，或对未成年人、少女形象的性化呈现",
}

# 内容风险的两档（与竞赛内容安全复核的结论对应）
RISK_LEVELS = ("可能被拒绝", "可能交人工")

SCORE_DIMS = ["文学底色", "叙事创新", "时代感", "感官对位"]

# ===== 统一内容安全口径（全局+局部；只拦性内容，其余写入风险提示）=====
_SAFETY_COMMON = """读者：10 岁以上的青少年（不含低幼）；作品也会被家长和老师读到。

【一、必须拦截（block）——只有这一类】
{block_rule}
其他任何内容都不拦截，即使很强烈，也只写进风险提示。

【二、内容风险提示（risks）】
先看全局：敏感元素在作品里起什么作用——警示、批判、象征、类型惯例，还是渲染、美化、诱导；作品立场是什么，结局把读者引向哪里；这类内容占多大篇幅，是一闪而过，还是成为全篇的主要观感。
再看局部：逐处看呈现方式，先对照下面的例子判断。全局立场正当，不能抵消局部越线。
· 可能被拒绝（对得上越线的例子）：
  - 具体的毒品名称、吸食或获取方式出现在作品里（儿童读物会让原本不知道的孩子知道这些名称，禁毒的意图抵消不了这一点）；
  - 对儿童施暴、拐卖、关押、持械追逐等直接而紧张的呈现（惊吓通常超过警示）；
  - 大段的血腥、伤口细节；直接描写自伤的行为、工具或过程；
  - 美化或诱导危险行为；煽动仇恨；
  - 多处强烈的呈现累积起来成为全篇基调，即使每一处单看都还不到越线。
· 可能交人工（没有清楚越线，但呈现强烈或有争议）：例如立场正当，而象征性的写法（表现内心痛苦的伤痕、血滴）可能让一部分读者联想到自伤或血腥；或对照例子仍无法判断的情况。
· 不算风险，不要写：死亡、霸凌、危险、坏人受惩罚这些题材本身；少年冒险、科幻、历险里推动情节、点到为止的打斗、受伤、流血；民间故事、童话、动物故事里的惯常情节（如妖怪洞里的骷髅、受伤动物腿上的一小块血迹）；作品先呈现、再推翻的批判对象；政治、宗教等符号本身。
没有风险就返回空列表。大多数作品都没有风险，不要为了填写而找问题。

【写法】简体中文。{where_rule}只写作品里看得到的事实，不得转述成作品里没有的话。reason 要说清对得上哪条标准、为什么。

【输出格式】严格 JSON，不含 Markdown：
{{"block": true 或 false, "block_type": "sexual_content"（仅 block 为 true 时填）, "evidence": "block 为 true 时指出最越界的一处，20 字以内",
  "risks": [{{"where": "{where_fmt}", "issue": "风险是什么，10 字以内", "level": "可能被拒绝 或 可能交人工", "reason": "对得上哪条标准、为什么，80 字以内"}}]}}"""

_TEXT_SAFETY_SYS = ("你是儿童文学评奖平台的内容安全审核员。你的任务是通读文本，做两件事：一、判断是否必须拦截；"
                    "二、按儿童文学奖的内容安全标准，指出可能需要拒绝或交人工裁定的内容风险。不做文学评价。\n\n"
                    + _SAFETY_COMMON.format(
                        block_rule="色情或性行为的具体描写；对儿童的任何性暗示或性化描写。（点到为止的亲密、拥抱、亲吻不拦。）",
                        where_rule="每处落到具体位置：where 填原文照录的一小句（15 字以内，必须逐字照抄原文）。",
                        where_fmt="原文照录，15 字以内"))

_IMG_SAFETY_SYS = ("你是儿童文学评奖平台的内容安全审核员。你的任务是通读全部插画，做两件事：一、判断是否必须拦截；"
                   "二、按儿童文学奖的内容安全标准，指出可能需要拒绝或交人工裁定的内容风险。不做艺术评价。\n\n"
                   + _SAFETY_COMMON.format(
                       block_rule="色情或性行为的描绘；对儿童的任何性化呈现；把角色性感化（内衣式服装、突出胸部等身体部位、挑逗姿态），尤其是少女形象。",
                       where_rule="每处落到具体位置，写作“第N幅”，按附图顺序，第 1 张为第 1 幅。引用画面上的文字必须原样照录，看不清就不引。",
                       where_fmt="第N幅"))

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

    # ---------- 独立前置：内容安全（文本分块 + 图像；各跑两次再合并）----------
    @classmethod
    def _parse_safety(cls, resp) -> dict:
        data = cls._load_json(resp)
        risks = data.get("risks") or []
        if not isinstance(risks, list):
            risks = []
        risks = [r for r in risks if isinstance(r, dict) and r.get("level") in RISK_LEVELS]
        return {"block": cls._affirm(data.get("block")),
                "block_type": data.get("block_type") or "sexual_content",
                "evidence": (data.get("evidence") or "").strip(),
                "risks": risks}

    @staticmethod
    def _same_place(a: str, b: str, is_text: bool) -> bool:
        """两次审查的位置是否同一处：插画比“第N幅”；文本比照录原文是否有 4 字以上重合。"""
        a, b = "".join(str(a).split()), "".join(str(b).split())
        if not a or not b:
            return False
        if not is_text:
            return a == b
        if a in b or b in a:
            return True
        from difflib import SequenceMatcher
        m = SequenceMatcher(None, a, b).find_longest_match(0, len(a), 0, len(b))
        return m.size >= 4

    @classmethod
    def _merge_safety(cls, runs: list, is_text: bool) -> dict:
        """两次审查合并（与在线视觉评审同一规则）：两次都判拦截才拦截；风险按位置对齐，
        两次同档才采用该档，不一致（档位不同或只出现一次）降为“可能交人工”。只拦截一次的，转为一条交人工提示。"""
        runs = [r for r in runs if isinstance(r, dict)]
        if not runs:
            return {"block": False, "risks": []}
        if len(runs) == 1:
            return runs[0]
        a, b = runs[0], runs[1]
        if a.get("block") and b.get("block"):
            return {"block": True, "block_type": a.get("block_type", "sexual_content"),
                    "evidence": a.get("evidence", ""), "risks": []}
        merged, used = [], set()
        b_risks = b.get("risks", [])
        for r in a.get("risks", []):
            j = next((j for j, o in enumerate(b_risks)
                      if j not in used and cls._same_place(r.get("where"), o.get("where"), is_text)), None)
            if j is not None:
                used.add(j)
            same = j is not None and b_risks[j].get("level") == r.get("level")
            merged.append({**r, "level": r.get("level") if same else "可能交人工"})
        for j, r in enumerate(b_risks):
            if j not in used:
                merged.append({**r, "level": "可能交人工"})
        one = a if a.get("block") else (b if b.get("block") else None)
        if one:
            merged.insert(0, {"where": "", "issue": "疑似性内容", "level": "可能交人工",
                              "reason": (one.get("evidence") or "") + "（两次审查结论不一致，须人工复核）"})
        return {"block": False, "risks": merged}

    @classmethod
    async def _safety_once(cls, contents, system_instruction) -> dict:
        # 温度 0.2：两次审查须是两次独立判断（只对不带思考档位的模型生效；3.8 本身就是独立采样）
        resp = await _generate(SCREEN_MODEL, contents, system_instruction, temperature=0.2)
        return cls._parse_safety(resp)

    @classmethod
    async def _safety_twice(cls, contents, system_instruction, is_text: bool, label: str) -> dict:
        runs = await asyncio.gather(cls._safety_once(contents, system_instruction),
                                    cls._safety_once(contents, system_instruction),
                                    return_exceptions=True)
        ok = []
        for r in runs:
            if isinstance(r, Exception):
                # 单次异常默认放行（不因一次抖动误伤真人作品）；两次都异常即本段不出结论
                print(f"⚠️ {label}内容安全审查一次异常，降级放行: {r}")
            else:
                ok.append(r)
        return cls._merge_safety(ok, is_text)

    @classmethod
    async def _scan_text_safety(cls, text: str) -> dict:
        chunks = cls._chunk_text(text)
        if not chunks:
            return {"block": False, "risks": []}
        n = len(chunks)
        results = await asyncio.gather(*[
            cls._safety_twice([f"【待审查文本{'片段 ' + str(i + 1) + '/' + str(n) if n > 1 else ''}】：\n{c}"],
                              _TEXT_SAFETY_SYS, True, f"文本第 {i + 1} 块")
            for i, c in enumerate(chunks)])
        risks = []
        for i, r in enumerate(results):
            if r.get("block"):
                return {**r, "where": "text"}
            for x in r.get("risks", []):
                w = str(x.get("where") or "").strip()
                risks.append({**x, "where": f"文本「{w}」" if w else "文本"})
        return {"block": False, "risks": risks}

    @classmethod
    async def _scan_image_safety(cls, pil_images: list) -> dict:
        if not pil_images:
            return {"block": False, "risks": []}
        contents = [f"以下为本作品全部 {len(pil_images)} 幅插画，请按要求审查："] + pil_images
        r = await cls._safety_twice(contents, _IMG_SAFETY_SYS, False, "插画")
        if r.get("block"):
            return {**r, "where": "image"}
        return {"block": False, "risks": [{**x, "where": f"插画{x.get('where') or ''}"} for x in r.get("risks", [])]}

    @staticmethod
    def render_risks(risks: list) -> str:
        """内容风险提示（无风险时返回空串）；供评语顶部统一加一次。"""
        if not risks:
            return ""
        order = {lv: i for i, lv in enumerate(RISK_LEVELS)}
        lines = ["⚠️【内容风险提示 · 须人工复核】以下几处在内容安全环节可能被拒绝或须交人工裁定；评分照常给出。"]
        for r in sorted(risks, key=lambda x: order.get(x.get("level"), 9)):
            where = f"{r.get('where')}｜" if r.get("where") else ""
            lines.append(f"- {where}{r.get('issue', '')}｜{r.get('level', '')}：{r.get('reason', '')}")
        return "\n".join(lines) + "\n\n"

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
            resp = await _generate(SCREEN_MODEL, contents, _AIGC_SYS, temperature=0.0)
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
        """内容安全 + AIGC 独立前置筛查。返回供调用方决定是否入围/是否标注。
        · 只有性内容（两次审查都判定）才 content_blocked；
        · 其余内容风险放在 risks 里，照常评审，由调用方在评语顶部标注、交人工复核。"""
        t_safe, i_safe, aigc = await asyncio.gather(
            cls._scan_text_safety(text),
            cls._scan_image_safety(pil_images),
            cls._scan_aigc(text, pil_images),
        )
        hit = t_safe if t_safe.get("block") else (i_safe if i_safe.get("block") else None)
        # 保持旧字段格式，contest_agent._build_block_message 无需改动
        content_safety = ({"content_violation": True, "violation_type": hit.get("block_type", "sexual_content"),
                           "evidence": hit.get("evidence", ""), "where": hit.get("where")}
                          if hit else {"content_violation": False})
        risks = [] if hit else (t_safe.get("risks", []) + i_safe.get("risks", []))

        # 未申明却检测到 AI → 打标（大赛口径：不拦，照评但显著标注）
        ai_flag = bool(aigc.get("suspected")) and not has_declared_ai

        return {
            "content_blocked": bool(hit),
            "content_safety": content_safety,
            "risks": risks,
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
                                    mark_ai: bool = True, mark_risks: bool = None):
        """
        多模态会诊（文本+插画）。内容安全与 AIGC 已改为独立前置：
        · 内容违规 → 不予入围、不评审（返回 content_blocked，供批处理记录/直接返回用户）。
        · 未申明却检测到 AI → 不拦，照常评审，结果显著标注（大赛口径）。
        调用方可在 persona 循环前调用 screen_work() 一次，并把结果作为 screen= 传入以复用，避免重复扫描。
        mark_ai=False 时本次不在单条评语顶部加 AIGC 横幅（由调用方在合并评语处统一加一次）。
        mark_risks 控制是否在单条评语顶部加内容风险提示，缺省跟随 mark_ai。
        """
        if mark_risks is None:
            mark_risks = mark_ai
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

        try:
            contents = [text] + (pil_images or [])
            response = await _generate(
                REVIEW_MODEL, contents, system_instruction,
                temperature=0.3, top_p=0.95, top_k=40,   # 仅对不带思考档位的模型生效
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

        # 5) 内容风险（非性内容）→ 不拦、照评，评语顶部提示，交人工复核
        risks = screen.get("risks") or []
        if risks and mark_risks:
            review = cls.render_risks(risks) + review

        return {
            "status": "reviewed",
            "content_blocked": False,
            "scores": scores,
            "review": review,
            "ai_probability": cls._ai_prob_from(aigc),
            "ai_flag": ai_flag,
            "aigc": aigc,
            "ai_declared": bool(has_declared_ai),
            "risks": risks,
        }
