# nal-api/services/vision_llm_service.py
# ============================================================================
# NAL 视觉分析服务 v3 —— 全量读取 · 分析指导版
#
# 相对 v2 的核心变更：
#   1. 全量读取：去除采样机制，所有图片全部送入模型
#   2. 分析模式：不做入围切片，只做分析与修改建议
#   3. Flash / Pro 双通道：
#      - Flash：一次调用，输出分析报告 + 总评判词
#      - Pro：两次调用，Flash 快速读图 → Pro 高清终评判词
#   4. 内容安全审查：独立前置调用（复用已加载图片，评审前拦截，命中即 422 不扣费）
#   5. AI 声明强制核验：声明纯原创但查出指纹 → 立即终止，不扣额度
#   6. 去除总分、去除入围预测、去除逐页文字、去除权重说明
#   7. 保留单项分数（供用户直观参考）、保留审美通道路由、保留章程 v2
#
# v3.1（2026-11）：
#   - 读者界定：儿童、孩子指青少年读者（10 岁以上，不含低幼）
#   - 插画意境改为界定范围：浓度、准确、余味与暗示力；不要求情绪递进
#   - 短板确实指不出时允许如实写，不再强求（强求会诱导模型编造短板）
#   - 内容安全改为"只拦色情与未成年人性化，其余提示"：其余敏感内容不再拦截，
#     按竞赛内容安全标准（全局+局部）在报告末尾给出"参赛内容风险提示"
#   - AI 指纹去掉 swinir（AI 放大工具，不是生成器；手绘扫描稿放大不应被判为使用 AI）
#   - 风险判断跑两次再合并：两次一致才采用；不一致降为"可能交人工"；两次都判性化才拦截
#   - 风险改法须在保留作品意图的前提下给出，不建议删除核心意象
#   - 引用画面文字必须原样照录，看不清就不引（安全审查、Flash、Pro 三处）
#   - 迁移到新版 SDK google-genai 与 Gemini 3.8 Flash（2.5 系列 2026-12-01 停用）：
#     对外接口不变；路由传入的旧模型名自动映射 gemini-2.5-flash → gemini-3.8-flash@low、
#     gemini-2.5-pro → gemini-3.8-flash@medium；写了思考档位的不再传 temperature。
#     依赖 pip install -U google-genai，读取环境变量 GEMINI_API_KEY（或 GOOGLE_API_KEY）
#   - 图片下载改为线程并发，不阻塞事件循环；限制超大图片像素，防解压炸弹
#
# v3.2 内存保护（在 google-genai 版本上重新合入；此前 13f5662 的保护被后续提交覆盖）：
#   - 流式下载限 15MB；解码前查像素（JPEG ≤ 5000 万、PNG ≤ 2500 万），格式白名单 JPG / PNG
#   - JPEG 缩尺解码（draft），原图与原始字节用完即释放
#   - 送模型的图片改为压缩 JPEG 字节（types.Part.from_bytes），不再常驻解码位图
#   - 全站并发闸：解码数（默认 1）与评审数（默认 2），可用环境变量 VISION_DECODE_CONCURRENCY /
#     VISION_EVAL_CONCURRENCY 调整；排队超时提示繁忙（503，不扣费）
#   - 被拒图片明确告知第几页、什么原因（422，不扣费）；Pro 终审前先释放 Flash 图片；
#     Pro 高清图缺页则降级返回 Flash 报告
# ============================================================================

import json
import io
import asyncio
import requests
import PIL.Image
from PIL import ImageFile
import os
from google import genai
from google.genai import types
from fastapi import HTTPException

ImageFile.LOAD_TRUNCATED_IMAGES = True

# ---- 内存保护（v3.2）----
MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024        # 单张图片下载上限 15MB
MAX_IMAGE_PIXELS_ACCEPT = 50_000_000         # JPEG 像素上限 5000 万（约 7000×7000），解码前检查
MAX_PNG_PIXELS = 25_000_000                  # PNG 像素上限 2500 万（约 5000×5000）：PNG 无法缩尺解码，
                                             # 单张解码约 4.5 字节/像素（2500 万 ≈ 110MB），须更严
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG"}     # MPO 是部分手机拍摄的 JPEG 变体
# 第二道保护：PIL 自带的解压炸弹检查。不设为 None。
PIL.Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS_ACCEPT

# 全站并发闸（模块级，跨请求共享；uvicorn 单进程内有效）
# 默认值按 512MB 实例设定；升级内存后可在 Render 环境变量里调大，无需改代码
_DECODE_SEM = asyncio.Semaphore(int(os.getenv("VISION_DECODE_CONCURRENCY", "1")))   # 同一时刻在解码的图片数
_EVAL_SEM = asyncio.Semaphore(int(os.getenv("VISION_EVAL_CONCURRENCY", "2")))       # 同一时刻在跑的视觉评审数
EVAL_QUEUE_TIMEOUT = 120                     # 排队超过 120 秒仍未轮到 → 提示繁忙，不扣费


class ImageRejected(Exception):
    """图片不符合上传规范（过大 / 格式不支持），消息直接展示给用户。"""

# ---- 模型调用（新版 SDK）----
LEGACY_MODEL_MAP = {
    "gemini-2.5-pro": "gemini-3.8-flash@medium",
    "gemini-2.5-flash": "gemini-3.8-flash@low",
}
_SAMPLING_KEYS = ("temperature", "top_p", "top_k")
_client = None


def _get_client():
    global _client
    if _client is None:
        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        _client = genai.Client(api_key=key) if key else genai.Client()
    return _client


def resolve_model(spec: str):
    """"gemini-3.8-flash@low" → ("gemini-3.8-flash", "low")；旧名先按 LEGACY_MODEL_MAP 换成新模型。"""
    spec = LEGACY_MODEL_MAP.get(str(spec).strip(), str(spec).strip())
    name, _, level = spec.partition("@")
    return name.strip(), (level.strip().lower() or None)


async def generate(spec: str, contents, system_instruction: str = None, json_mode: bool = False, **cfg):
    """统一的异步调用（contents 可直接放 PIL 图片）：写了思考档位的设 thinking_level、去掉采样参数。"""
    name, level = resolve_model(spec)
    kw = dict(cfg)
    if system_instruction:
        kw["system_instruction"] = system_instruction
    if json_mode:
        kw["response_mime_type"] = "application/json"
    if level:
        for k in _SAMPLING_KEYS:
            kw.pop(k, None)
        kw["thinking_config"] = types.ThinkingConfig(thinking_level=level)
    return await _get_client().aio.models.generate_content(
        model=name, contents=contents, config=types.GenerateContentConfig(**kw))


# 分辨率分层
FLASH_MAX_DIM = 1024   # Flash 初读：降低内存峰值
PRO_MAX_DIM   = 1536   # Pro 终审：细判东方笔触/材质

# AI 元数据指纹库
AI_KEYWORDS = [
    'stable diffusion', 'midjourney', 'dall-e', 'dall·e',
    'comfyui', 'automatic1111', 'novelai', 'parameters',
    'cfg scale', 'sampler', 'steps:', 'lora', 'controlnet',
    'dreamshaper', 'invokeai', 'leonardo.ai', 'sdxl'
]

# 内容违规类型的中文说明
# 只有这一类拦截（422，不扣额度）；其余敏感内容在报告里提示参赛风险
VIOLATION_LABELS = {
    "sexual_content":     "色情性行为描绘，或对未成年人、少女形象的性化呈现",
}

# 参赛风险的两档（与竞赛内容安全复核的结论对应）
RISK_LEVELS = ("可能被拒绝", "可能交人工")


class VisionLLMService:

    # =========================================================
    # 图片加载与 AI 指纹提取
    # =========================================================

    @staticmethod
    def _download_limited(url: str) -> bytes:
        """流式下载，超过 MAX_DOWNLOAD_BYTES 立即中止，不把超大响应整个读进内存。"""
        limit_mb = MAX_DOWNLOAD_BYTES // (1024 * 1024)
        with requests.get(url, timeout=15, stream=True) as response:
            response.raise_for_status()
            declared = response.headers.get("Content-Length", "")
            if declared.isdigit() and int(declared) > MAX_DOWNLOAD_BYTES:
                raise ImageRejected(f"文件过大（{int(declared) / 1048576:.1f}MB），单张上限 {limit_mb}MB")
            buf = io.BytesIO()
            for chunk in response.iter_content(chunk_size=256 * 1024):
                if not chunk:
                    continue
                buf.write(chunk)
                if buf.tell() > MAX_DOWNLOAD_BYTES:
                    raise ImageRejected(f"文件过大，单张上限 {limit_mb}MB")
            return buf.getvalue()

    @staticmethod
    def _fetch_and_process_image(url: str, max_dim: int = FLASH_MAX_DIM) -> tuple:
        """从 URL 下载图片，提取 AI 元数据指纹，再降采样压缩。
        返回 (img, ai_fingerprint, error)：
          - 成功：img 为 types.Part（压缩 JPEG 字节，直接交给 Gemini，不常驻解码位图），error 为 None
          - 失败：img 为 None，error 为给用户看的原因"""
        too_big_msg = (f"图片尺寸过大，请压缩到 {MAX_IMAGE_PIXELS_ACCEPT // 1_000_000} 百万像素以内"
                       f"（例如 7000×7000 以内）后重新上传")
        raw = None
        img = None
        try:
            raw = VisionLLMService._download_limited(url)
            img = PIL.Image.open(io.BytesIO(raw))   # 只读文件头，此时尚未解码像素

            # ① 格式白名单
            if img.format not in ALLOWED_FORMATS:
                raise ImageRejected(f"格式不支持（{img.format or '未知'}），仅接受 JPG / PNG")

            # ② 解码前查像素：超大图在这里就拒绝，绝不进入解码（OOM / 解压炸弹的根源）
            w, h = img.size
            if img.format == "PNG" and w * h > MAX_PNG_PIXELS:
                raise ImageRejected(
                    f"PNG 图片尺寸过大（当前 {w}×{h}），请压缩到 {MAX_PNG_PIXELS // 1_000_000} 百万像素以内"
                    f"（例如 5000×5000 以内），或另存为 JPG 后重新上传"
                )
            if w * h > MAX_IMAGE_PIXELS_ACCEPT:
                raise ImageRejected(f"{too_big_msg}（当前 {w}×{h}）")

            # ③ JPEG 缩尺解码：直接以接近目标尺寸的比例解码，峰值内存降一个量级（PNG 不支持，自动忽略）
            try:
                img.draft("RGB", (max_dim, max_dim))
            except Exception:
                pass

            ai_fingerprint = ""
            meta_text = ""

            if hasattr(img, 'text') and img.text:
                for k, v in img.text.items():
                    meta_text += f"{k}:{v}\n".lower()

            if hasattr(img, 'info') and img.info:
                for k, v in img.info.items():
                    if k != 'exif':
                        meta_text += f"{k}:{str(v)}\n".lower()

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
                    ai_fingerprint = kw
                    break

            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim), PIL.Image.Resampling.LANCZOS)

            out = io.BytesIO()
            img.convert("RGB").save(out, format="JPEG", quality=85)
            # 只保留压缩字节（每张约 0.1–0.3MB），解码位图随原图一起释放
            return types.Part.from_bytes(data=out.getvalue(), mime_type="image/jpeg"), ai_fingerprint, None

        except ImageRejected as e:
            print(f"⚠️ 图片被拒 ({url}): {e}")
            return None, "", str(e)
        except PIL.Image.DecompressionBombError:
            print(f"⚠️ 图片被拒（解压炸弹保护）({url})")
            return None, "", too_big_msg
        except Exception as e:
            print(f"⚠️ 图片加载失败 ({url}): {e}")
            return None, "", "无法读取（文件可能损坏，或链接暂时不可访问），请重新上传"
        finally:
            # ④ 用完即释放：关闭原图、丢弃原始字节
            if img is not None:
                try:
                    img.close()
                except Exception:
                    pass
            raw = None

    @classmethod
    async def _load_images(cls, image_urls: list, max_dim: int) -> list:
        """下载并压缩图片，保持原顺序。返回 [(img, fingerprint, error), ...]。
        解码走全站共享的 _DECODE_SEM，多人同时评审也不会把内存叠爆。"""

        async def one(url):
            async with _DECODE_SEM:
                return await asyncio.to_thread(cls._fetch_and_process_image, url, max_dim)

        return await asyncio.gather(*[one(u) for u in image_urls])

    # =========================================================
    # 内容安全前置审查（独立一次调用，在主分析之前执行）
    # =========================================================

    @classmethod
    async def _check_content_safety(cls, images: list, target_model: str, image_type: str = "picturebook") -> dict:
        """
        内容安全前置审查（独立一次调用，只做安全判断，不掺评审）。
        返回 {"block": bool, "block_type": "sexual_content", "evidence": "...",
              "risks": [{"where": "第N页", "issue": "...", "level": "可能被拒绝|可能交人工", "reason": "..."}]}
        - 只有色情、未成年人/少女形象性化才拦截（block=True）。
        - 其余按竞赛内容安全标准（全局+局部）判断，写进 risks，在报告末尾提示，不拦截。
        """
        unit = "幅" if image_type == "illustration" else "页"
        safety_instruction = f"""你是儿童文学（绘本/插画）作品分析平台的内容安全审核员。作者把作品提交来求取修改意见；你的任务是通读全部画面，做两件事：一、判断是否必须拦截；二、按儿童文学奖的内容安全标准，指出这部作品若去参赛可能遇到的内容风险。不做艺术评价。

读者：10 岁以上的青少年（不含低幼）；作品也会被家长和老师读到。

【一、必须拦截（block）——只有这一类】
色情或性行为的描绘；对儿童的任何性化呈现；把角色性感化（内衣式服装、突出胸部等身体部位、挑逗姿态），尤其是少女形象。
其他任何内容都不拦截，即使很强烈，也只写进风险提示。

【二、参赛风险提示（risks）】
先看全局：敏感元素在全书（全组）里起什么作用——警示、批判、象征、类型惯例，还是渲染、美化、诱导；作品立场是什么，结局把读者引向哪里；这类画面占多大篇幅，是一闪而过，还是成为全书的主要观感。
再看局部：逐处看呈现方式，先对照下面的例子判断。全局立场正当，不能抵消局部越线。
· 可能被拒绝（对得上越线的例子）：
  - 具体的毒品名称、吸食或获取方式出现在画面或文字里（儿童读物会让原本不知道的孩子知道这些名称，禁毒的意图抵消不了这一点）；
  - 对儿童施暴、拐卖、关押、持械追逐等直接而紧张的呈现（惊吓通常超过警示）；
  - 大面积的血迹、伤口特写；直接描绘自伤的行为、工具或过程；
  - 美化或诱导危险行为；煽动仇恨；
  - 多处强烈的呈现累积起来成为全书基调，即使每一处单看都还不到越线。
· 可能交人工（没有清楚越线，但呈现强烈或有争议）：例如立场正当，而象征性的画面（表现内心痛苦的伤痕、血滴）可能让一部分读者联想到自伤或血腥；或对照例子仍无法判断的情况。
· 不算风险，不要写：死亡、霸凌、危险、坏人受惩罚这些题材本身；民间故事、童话、动物故事里点到为止的惯常情节（如妖怪洞里的骷髅、受伤动物腿上的一小块血迹）；作品先呈现、再推翻的批判对象；政治、宗教等符号本身。
没有风险就返回空列表。大多数作品都没有风险，不要为了填写而找问题。

【写法】简体中文。每处落到具体位置，写作"第N{unit}"，按附图顺序，第 1 张为第 1 {unit}。只写画面和文字里看得到的事实；引用画面上的文字必须原样照录，看不清就不引，不得转述成画面上没有的话。reason 要说清对得上哪条标准、为什么，并给一句怎么改能避开。改法须在保留作品意图的前提下给出（例如改为暗示、减少数量或篇幅、去掉具体名称），不建议删除作品的核心意象——作者为表达主题而设的意象，改法应是调整呈现方式，而不是拿掉它。

【输出格式】严格 JSON，不含 Markdown：
{{"block": true 或 false, "block_type": "sexual_content"（仅 block 为 true 时填）, "evidence": "block 为 true 时指出最越界的一处，20 字以内",
  "risks": [{{"where": "第N{unit}", "issue": "风险是什么，10 字以内", "level": "可能被拒绝 或 可能交人工", "reason": "对得上哪条标准、为什么、保留意图前提下怎么改能避开，80 字以内"}}]}}"""

        try:
            contents = [f"以下为本作品全部 {len(images)} {unit}画面，请按要求审查："] + images

            # 温度 0.2（与竞赛复核一致）：两次审查须是两次独立判断，温度为 0 时两次几乎相同，合并就失去意义
            # 2.5 系列用温度 0.2；3.x 不接受温度，两次审查本身就是独立采样
            res = await generate(target_model, contents, system_instruction=safety_instruction,
                                 json_mode=True, temperature=0.2)

            if res.candidates and res.candidates[0].content.parts:
                result = json.loads(res.text)
                # 模型有时返回列表而非对象，取第一个元素
                if isinstance(result, list):
                    result = result[0] if result else {}
                if not isinstance(result, dict):
                    return {"block": False, "risks": []}
                risks = result.get("risks") or []
                if not isinstance(risks, list):
                    risks = []
                risks = [r for r in risks if isinstance(r, dict) and r.get("level") in RISK_LEVELS]
                return {"block": bool(result.get("block")),
                        "block_type": result.get("block_type") or "sexual_content",
                        "evidence": result.get("evidence", ""),
                        "risks": risks}
            return {"block": False, "risks": []}

        except Exception as e:
            print(f"⚠️ 内容安全审查异常（默认放行，不出风险提示）: {e}")
            return {"block": False, "risks": []}

    @staticmethod
    def _merge_safety(runs: list) -> dict:
        """两次审查合并：两次都判拦截才拦截；风险按位置对齐，两次同档才采用该档，
        不一致（档位不同或只出现一次）降为"可能交人工"。只拦截一次的，转为一条交人工提示。"""
        runs = [r for r in runs if isinstance(r, dict)]
        if not runs:
            return {"block": False, "risks": []}
        if len(runs) == 1:
            return runs[0]
        a, b = runs[0], runs[1]
        if a.get("block") and b.get("block"):
            return {"block": True, "block_type": a.get("block_type", "sexual_content"),
                    "evidence": a.get("evidence", ""), "risks": []}

        def key(r):
            return "".join(str(r.get("where", "")).split())

        merged, seen = [], set()
        b_by = {key(r): r for r in b.get("risks", [])}
        for r in a.get("risks", []):
            k = key(r); seen.add(k)
            other = b_by.get(k)
            lv = r.get("level") if other and other.get("level") == r.get("level") else "可能交人工"
            merged.append({**r, "level": lv})
        for k, r in b_by.items():
            if k not in seen:
                merged.append({**r, "level": "可能交人工"})
        one = a if a.get("block") else (b if b.get("block") else None)
        if one:
            merged.insert(0, {"where": "", "issue": "疑似性化呈现", "level": "可能交人工",
                              "reason": (one.get("evidence") or "") + "（两次审查结论不一致，建议自查人物造型与姿态）"})
        return {"block": False, "risks": merged}

    @staticmethod
    def _render_risks(risks: list) -> str:
        """参赛内容风险提示（无风险时返回空串）。"""
        if not risks:
            return ""
        order = {lv: i for i, lv in enumerate(RISK_LEVELS)}
        lines = ["", "#### ⚠️ 参赛内容风险提示",
                 "以下几处若参加儿童文学奖评审，可能在内容安全环节被拒绝或交人工裁定。本次分析不受影响，供修改时参考。", ""]
        for r in sorted(risks, key=lambda x: order.get(x.get("level"), 9)):
            where = f"{r.get('where')}｜" if r.get("where") else ""
            lines.append(f"- **{where}{r.get('issue', '')}｜{r.get('level', '')}**：{r.get('reason', '')}")
        return "\n".join(lines)

    # =========================================================
    # Prompt 构建
    # =========================================================

    @classmethod
    def _get_flash_instruction(cls, image_type: str, has_declared_ai: bool, found_ai_fingerprints: list, page_format: str = "single") -> str:
        """Flash 一次调用的 system instruction（绘本 / 插画共用框架，维度分流）"""

        core_philosophy = """
【章程 v2：儿童文学主权条款（评审总前提）】
本赛事是儿童文学奖项。绘本与插画在此接受儿童文学的检验，而非纯美术的检验。
- 读者：儿童、孩子在这里都指青少年读者（10 岁以上，不含低幼）。
- 情感的真挚浓度与儿童可通达性，决定作品的天花板；技法完成度决定地板。
- 反平庸条款：套路化的甜腻不应高于笨拙的真挚。
- 材质盾牌：材质本身不构成加减分理由，加减分只来自材质与情感传达的咬合程度。

【🚨 视觉评审三大陷阱】
1. 「精美陷阱」：视觉精美但沦为画廊展品，未参与叙事 → 严厉扣分。
2. 「视觉人造儿童」：将儿童宠物化、弱智化，披着低幼外衣的刻板说教 → 严厉扣分。
3. 「图文复读机」：画出来的与写出来的完全重合 → 严厉扣分。"""

        channel_routing = """
【🧭 审美路由（先分流，再评审）】
路由依据是画面自身的视觉语法，不是作者声明的媒介。
1. 「西方写实」：考核透视、解剖、光影的严谨与突破。
2. 「东方意象」：以气韵、留白、骨法用笔为法度。大面积留白是呼吸与意境，不是"构图空洞"；散点透视是语法，不是"透视错误"。严禁以西式透视苛求本通道。
3. 「原生态装饰」：民间美术、岩彩、剪纸等传统语汇。平面化与程式化是文化基因，不是"造型能力不足"。
4. 「稚拙先锋」：儿童涂鸦感、率真笔触、综合材料实验。稚拙是艺术选择，不是技法缺陷。

【全局语义冲突豁免】
高密度跨界并置（古典+现代、真实材质+手绘拼贴、刻意的比例错乱）且具有系统性设计与可辨认的情感指向时，优先判定为"观念性荒诞/隐喻"，关闭透视与解剖学红线。"""

        # AI 审查策略
        fingerprint_str = ", ".join(found_ai_fingerprints) if found_ai_fingerprints else ""
        if has_declared_ai:
            ai_policy = f"""
【🤖 AI 辅助声明：已声明使用 AI（底层特征：{fingerprint_str if fingerprint_str else '依靠视觉研判'}）】
包容其工具属性，但必须尖锐指出"机器感"浓厚之处（塑料光影、细节逻辑错乱、空间透视崩坏），并指导创作者如何通过人类主观美学进行"二次艺术打磨"。"""
        else:
            ai_policy = """
【🤖 AI 痕迹筛查：未声明 AI 辅助，未查出底层指纹】
开启极高敏锐度的 AI 痕迹筛查。寻找疑似生成式 AI 的典型缺陷（无逻辑背景元素融合、过度完美的商业插画质感但情感空洞、角色细微结构崩坏）。如有强烈 AI 痕迹，严厉指出。"""

        # 维度定义（绘本 / 插画分流）
        if image_type == "picturebook":
            if page_format == "spread":
                synergy_note = """3. 图文协同与翻页节奏 score_synergy（满分 2.5）：
   【跨页合图模式】每张图为左右两页合并，请重点评审：
   - 跨页构图张力：装订线两侧的视觉重量是否平衡？画面元素是否跨越装订线形成完整动势？
   - 翻页悬念设计：右页末尾的视觉元素是否引导读者迫切翻页？左页开篇是否承接上一跨页的情绪？
   - 【巴德留白测试】文字少说的地方，图画接住了吗？
   - 【间隙判据】文与图之间刻意的错位、反讽与张力是最高级形态，须重点识别并奖励。"""
            else:
                synergy_note = """3. 图文协同与翻页节奏 score_synergy（满分 2.5）：
   【单页模式】每张图为单独一页，翻页节奏基于页序推断：
   - 【巴德留白测试】文字少说的地方，图画接住了吗？
   - 【复读机判据】画出来的与写出来的完全重合 = 图像沦为文字附庸，本维度重扣。
   - 【间隙判据】文与图之间刻意的错位、反讽与张力是最高级形态，须重点识别并奖励。
   - 注意：跨页构图张力无法在单页模式下评审，请勿以此扣分。"""

            dimensions = f"""
【核心评分维度】
1. 故事与立意完成度 score_narrative（满分 4.0）：情节完整自洽、情感共鸣与母题深度。
2. 图像语言与视觉张力 score_visual（满分 3.5）：造型、构图、色彩与风格统一度。按审美通道法度评判。含传统元素时计入"文化活化张力"。
{synergy_note}"""

            analysis_fields = """
"narrative_reading": "【故事还原】150字以内，用平实的话讲清核心故事线与角色心理转变，指明起点、转折点与结局。只讲从画面读出的内容，不套理论。",
"visual_text_interplay": "【图文互文】指出画面在哪些具体细节上补充、推翻或超越了作者提供的故事说明，举出具体的画面之处。","""

            score_fields = """
"score_narrative": 浮点数 (0.0-4.0，故事与立意完成度),
"score_visual": 浮点数 (0.0-3.5，图像语言与视觉张力),
"score_synergy": 浮点数 (0.0-2.5，图文协同与翻页节奏),"""

        else:  # illustration
            dimensions = """
【核心评分维度】
1. 意境 score_mood（满分 4.0）：作品选定的情绪被画面做到什么程度——浓度（是否饱满）、准确（画面是否恰好传达它）、余味（看完是否留得住），以及"一幅画暗示未展开故事"的暗示力；须青少年观者可通达。
   - 本项的范围：情绪是否复杂、系列有没有递进或转折，不在本项评判范围之内。单一而饱满的情绪和复杂的情绪一样可以得高分；温暖、轻柔、明朗、幽默同样有高下，高下看浓度、准确与余味。原因是：插画多为单幅或组图，一幅或一组画把一种状态做足，本身就是完整的作品。
2. 视觉语法与技法完成度 score_craft（满分 3.5）：造型、构图、色彩与风格统一度。按审美通道法度评判。含传统元素时计入"文化活化张力"。
3. 独创性与风格辨识度 score_originality（满分 2.5）：个人视觉语法的独特性与先锋性，而非似曾相识的流行插画风。
   - 【修辞偏差防御】创作说明仅供背景参考，说明文采不影响视觉评分。
   - 【静默张力】克制、留白与负空间的情绪蓄势同样是张力，不得将安静误判为乏力。"""

            analysis_fields = """
"visual_reading": "【画面读解】150字以内，用平实的话讲清这（组）画在描绘或暗示什么：情境、情绪，以及它作为插画暗示了怎样一个未完全展开的故事。只讲从画面读出的内容，不套理论。",
"series_coherence": "【系列统一性】系列填：风格是否贯通、各幅是否构成一个整体（视觉序列，或以统一的情绪构成一个完整状态，都成立；不要求情绪递进），指出具体的贯通点或断裂处在哪几幅。单幅填：单幅无系列。","""

            score_fields = """
"score_mood": 浮点数 (0.0-4.0，意境：浓度、准确、余味与暗示力),
"score_craft": 浮点数 (0.0-3.5，视觉语法与技法完成度),
"score_originality": 浮点数 (0.0-2.5，独创性与风格辨识度),"""

        calibration = """
【打分校准纪律】
- 分数带：三项之和 9.0+ 为顶尖决选级稀缺水准；7.5-8.9 具备竞争力；6.0-7.4 合格但平庸；6.0 以下存在明显缺陷。
- 三个维度独立评定，精确到 0.1；各项按实际水平给分，不必刻意拉开。
- 如实指出短板，落实到具体视觉元素。满分代表这一项的理想状态，作品很少达到；如果确实指不出哪一处还差，就如实写"已达上乘，未见可指认的差距"，分数照样落在高段。只在确实指不出时才这样写。"""

        cot_steps = """
【强制执行步骤：先看，后判，最后打分】
1. visual_observation：纯事实观察，只陈述画面事实。严禁任何评价性词汇。
2. dominant_tradition：完成审美路由。
3. irreplaceable_value + main_weakness：双向价值陈述，必须落实到观察层事实。
4. critique + ai_assessment：展开点评与 AI 审查。
5. 最后才是分数。"""

        work_name = "绘本作品" if image_type == "picturebook" else "插画作品"

        verdict_rules = """
【判词的三条铁律（贯穿所有文字评价，尤其是点评与判词）】
一、落到具体处：每一句判断都要咬住画面里的具体对象——哪一页、画面的哪个位置、哪个视觉元素（某个色块、某条线、某处留白、某个角色的神态）。放到任何作品上都成立的话，不要写。
二、讲清为什么：不要停在"意境深远""构图精妙"这类结论上。要说清因为画面上的什么（具体现象），所以得出什么判断。遇到形容词，后面必须跟上"体现在哪里"。
三、术语为判断服务：气韵、留白、互文、骨法用笔、张力这类概念，只在它此刻最能一针见血时才用，且用完立刻用一句话说清它在这幅画里具体指什么。为显得专业而堆砌术语，是不专业的表现，明确禁止。
四、引用画面上的文字必须原样照录，看不清就不引，不得转述成画面上没有的话。

【定位与语气】
你是一位资深的儿童文学编辑与插画评审，判词写给创作者本人看，他要靠它判断画好在哪、弱在哪、怎么改。专业体现在判断准确、依据扎实，不在词汇艰深。语气客观中肯、就事论事，好就是好、不好就是不好，不夸大也不打压。"""

        return f"""你是 NAL 儿童文学视觉分析专家与艺术指导顾问。请对这组【{work_name}】进行深度分析，重点提出具体可执行的修改建议。严格以 JSON 格式输出。

{core_philosophy}
{channel_routing}
{ai_policy}
{dimensions}
{calibration}
{verdict_rules}
{cot_steps}

（内容安全已在评审前由独立环节完成审核，此处无需再做内容安全判断，专注艺术分析即可。）

【强制 JSON 输出格式（不含任何 Markdown 标记）】
{{
    "visual_observation": "纯事实观察记录（150字内）：画面内容、色彩主导、笔触质地、视线动线、跨页/跨图变化。严禁评价性词汇。",
    "dominant_tradition": "限五个固定值之一：'西方写实'、'东方意象'、'原生态装饰'、'稚拙先锋'、'综合无明显传统'",
    "has_traditional_elements": "YES 或 NO",
    {analysis_fields}
    "irreplaceable_value": "30-60字：这部作品最打动人、最难被替代的一处，指明是画面上的哪个具体之处。答不出则以'可替代'开头说明原因。",
    "main_weakness": "30-60字：最主要的一处短板，指明在画面的哪个位置、是什么问题。确实指不出时，如实写'已达上乘，未见可指认的差距'。",
    "critique": "综合点评与可执行的修改建议。每个判断都咬住画面具体之处，按该作品所属审美通道的法度来谈，说清好在哪、弱在哪、具体怎么改。",
    "ai_assessment": "基于声明情况与指纹证据，客观说明是否存在 AI 痕迹或机器感，依据要具体到画面的哪一处（约100字）。",
    {score_fields}
    "flash_verdict": "总评判词，80-150字：综合说清这组画最站得住的地方和最该改的地方，每句都落到画面具体处，讲清为什么。不堆砌术语，不说放之四海皆准的空话。"
}}"""

    @classmethod
    def _get_pro_instruction(cls, image_type: str, flash_result: dict) -> str:
        """Pro 第二次调用的 system instruction，基于 Flash 结果做高清终评。"""

        work_name = "绘本作品" if image_type == "picturebook" else "插画作品"

        flash_summary = f"""
【Flash 初读结果（供参考，可在深度审查中修正）】
- 审美通道：{flash_result.get('dominant_tradition', '未知')}
- 含传统元素：{flash_result.get('has_traditional_elements', '未知')}
- 不可替代之处：{flash_result.get('irreplaceable_value', '未提供')}
- 主要短板：{flash_result.get('main_weakness', '未提供')}
- 初读评语：{flash_result.get('flash_verdict', '未提供')}"""

        if image_type == "picturebook":
            flash_summary += f"""
- 故事还原：{flash_result.get('narrative_reading', '未提供')}
- 图文互文：{flash_result.get('visual_text_interplay', '未提供')}
- 初读分数：故事/立意 {flash_result.get('score_narrative', 'N/A')}/4.0 | 图像语言 {flash_result.get('score_visual', 'N/A')}/3.5 | 图文协同 {flash_result.get('score_synergy', 'N/A')}/2.5"""
            score_fields = """
    "score_text_philosophy": 浮点数 (0.0-4.0，故事深度：故事与立意能否打动不同年龄的读者),
    "score_visual_tension": 浮点数 (0.0-3.5，画面语言：高清下细看笔触、材质、构图的表现力),
    "score_synergy_depth": 浮点数 (0.0-2.5，图文配合：文字与画面是互相补充、还是互相重复),"""
        else:
            flash_summary += f"""
- 画面读解：{flash_result.get('visual_reading', '未提供')}
- 系列统一性：{flash_result.get('series_coherence', '未提供')}
- 初读分数：意境/张力 {flash_result.get('score_mood', 'N/A')}/4.0 | 技法 {flash_result.get('score_craft', 'N/A')}/3.5 | 独创性 {flash_result.get('score_originality', 'N/A')}/2.5"""
            score_fields = """
    "score_mood_depth": 浮点数 (0.0-4.0，画面感染力：选定情绪的浓度、准确与余味，以及它暗示的故事张力；情绪是否复杂、系列有无递进不在本项范围),
    "score_visual_tension": 浮点数 (0.0-3.5，画面语言：高清下细看笔触、材质、构图的表现力),
    "score_originality_depth": 浮点数 (0.0-2.5，独创性：个人风格的辨识度与不可替代性),"""

        return f"""你是一位资深的儿童文学插画终审评审。你正在对这组【{work_name}】做高清细看后的最终评定，写一段写给创作者本人看的终评。

{flash_summary}

【判词的三条铁律】（终评全文都要遵守）
一、落到具体处：每一句判断都咬住画面里的具体对象——哪一页、画面哪个位置、哪个视觉元素。放到任何作品上都成立的话，不要写。
二、讲清为什么：说清因为画面上的什么（具体现象），所以得出什么判断。不要停在"意境深远""笔触精到"这类结论上。
三、术语为判断服务：用某个专业概念时，必须是它此刻最能说清问题，且用完立刻用一句话解释它在这幅画里具体指什么。不为显得专业而堆砌术语。
四、引用画面上的文字必须原样照录，看不清就不引，不得转述成画面上没有的话。

【语气】客观、中肯、就事论事。专业体现在判断准确、依据扎实，不在词汇艰深。

【读者】儿童、孩子在这里都指青少年读者（10 岁以上，不含低幼）。

【满分与高分之间】满分代表理想状态，作品很少达到。某一项若已到高段，又确实指不出哪一处还差，就如实写"已达上乘，未见可指认的差距"，不必另找理由。

【你的任务】
1. 以高清图为主要依据，对 Flash 初读结论做确认、深化或修正。若初读有明显看错之处，直接指出错在哪、实际是什么。
2. 高清下能看清的东西要用上：笔触的轻重、材质的肌理、构图的安排——但都要落到具体画面，说清它带来了什么效果，而不是罗列这些名词。
3. 写一段 300-500 字的终评（final_review）：既说清这组画最站得住的地方，也指出最该改的地方，并给出具体怎么改。每个判断都要有画面依据，不说空话、不堆术语。

【强制 JSON 输出格式（不含任何 Markdown 标记）】
{{
    {score_fields}
    "final_review": "300-500字终评，每个判断都落到画面具体处、讲清为什么，既有亮点也有可执行的改进方向，不堆砌术语、不说套话。"
}}"""

    # =========================================================
    # 报告渲染
    # =========================================================

    @classmethod
    def _render_flash_report(cls, result: dict, image_type: str, image_count: int, risks: list = None) -> str:
        """将 Flash JSON 结果渲染为 Markdown 报告。"""

        if image_type == "picturebook":
            score_line = (
                f"故事/立意 **{result.get('score_narrative', 'N/A')}**/4.0 　｜　"
                f"图像语言 **{result.get('score_visual', 'N/A')}**/3.5 　｜　"
                f"图文协同 **{result.get('score_synergy', 'N/A')}**/2.5"
            )
            analysis_section = f"""
#### 📚 故事还原
{result.get('narrative_reading', 'N/A')}

#### 🖼️ 图文互文
{result.get('visual_text_interplay', 'N/A')}"""
        else:
            score_line = (
                f"意境/张力 **{result.get('score_mood', 'N/A')}**/4.0 　｜　"
                f"视觉语法/技法 **{result.get('score_craft', 'N/A')}**/3.5 　｜　"
                f"独创性 **{result.get('score_originality', 'N/A')}**/2.5"
            )
            analysis_section = f"""
#### 🖼️ 画面读解
{result.get('visual_reading', 'N/A')}

#### 🔗 系列统一性
{result.get('series_coherence', 'N/A')}"""

        tradition = result.get('dominant_tradition', '未路由')
        has_trad = result.get('has_traditional_elements', 'N/A')

        return f"""### {'📖' if image_type == 'picturebook' else '🎨'} NAL {'绘本' if image_type == 'picturebook' else '插画'}视觉分析报告

**🧭 审美通道：{tradition}**　｜　**传统元素：{has_trad}**　｜　**送审图片：{image_count} 幅**

#### 📊 单项评分
{score_line}

---
{analysis_section}

#### 👁️ 画面观察记录
{result.get('visual_observation', 'N/A')}

#### ✨ 不可替代之处
{result.get('irreplaceable_value', 'N/A')}

#### 🔧 主要短板
{result.get('main_weakness', 'N/A')}

#### 💡 综合点评与修改建议
{result.get('critique', 'N/A')}

#### 🎓 总评判词
{result.get('flash_verdict', 'N/A')}

#### 🤖 AI 辅助声明与浓度审查
{result.get('ai_assessment', '系统未检测到明显 AI 痕迹。')}""" + cls._render_risks(risks)

    @classmethod
    def _render_pro_report(cls, flash_result: dict, pro_result: dict, image_type: str, image_count: int, risks: list = None) -> str:
        """将 Flash + Pro 双层结果渲染为完整 Markdown 报告。"""

        if image_type == "picturebook":
            flash_score_line = (
                f"故事/立意 **{flash_result.get('score_narrative', 'N/A')}**/4.0 　｜　"
                f"图像语言 **{flash_result.get('score_visual', 'N/A')}**/3.5 　｜　"
                f"图文协同 **{flash_result.get('score_synergy', 'N/A')}**/2.5"
            )
            pro_score_line = (
                f"故事深度 **{pro_result.get('score_text_philosophy', 'N/A')}**/4.0 　｜　"
                f"画面语言 **{pro_result.get('score_visual_tension', 'N/A')}**/3.5 　｜　"
                f"图文配合 **{pro_result.get('score_synergy_depth', 'N/A')}**/2.5"
            )
            analysis_section = f"""
#### 📚 故事还原
{flash_result.get('narrative_reading', 'N/A')}

#### 🖼️ 图文互文
{flash_result.get('visual_text_interplay', 'N/A')}"""
        else:
            flash_score_line = (
                f"意境/张力 **{flash_result.get('score_mood', 'N/A')}**/4.0 　｜　"
                f"视觉语法/技法 **{flash_result.get('score_craft', 'N/A')}**/3.5 　｜　"
                f"独创性 **{flash_result.get('score_originality', 'N/A')}**/2.5"
            )
            pro_score_line = (
                f"画面感染力 **{pro_result.get('score_mood_depth', 'N/A')}**/4.0 　｜　"
                f"画面语言 **{pro_result.get('score_visual_tension', 'N/A')}**/3.5 　｜　"
                f"独创性 **{pro_result.get('score_originality_depth', 'N/A')}**/2.5"
            )
            analysis_section = f"""
#### 🖼️ 画面读解
{flash_result.get('visual_reading', 'N/A')}

#### 🔗 系列统一性
{flash_result.get('series_coherence', 'N/A')}"""

        tradition = flash_result.get('dominant_tradition', '未路由')
        has_trad = flash_result.get('has_traditional_elements', 'N/A')

        return f"""### {'📖' if image_type == 'picturebook' else '🎨'} NAL {'绘本' if image_type == 'picturebook' else '插画'}视觉深度分析报告（Pro 终审版）

**🧭 审美通道：{tradition}**　｜　**传统元素：{has_trad}**　｜　**送审图片：{image_count} 幅**

#### 📊 初读单项评分
{flash_score_line}

#### 📊 终审深度评分（高清二次判读）
{pro_score_line}

---
{analysis_section}

#### 👁️ 画面观察记录
{flash_result.get('visual_observation', 'N/A')}

#### ✨ 不可替代之处
{flash_result.get('irreplaceable_value', 'N/A')}

#### 🔧 主要短板
{flash_result.get('main_weakness', 'N/A')}

#### 💡 综合点评与修改建议
{flash_result.get('critique', 'N/A')}

#### 🎓 终评判词（Pro 高清终审）
{pro_result.get('final_review', 'N/A')}

#### 🤖 AI 辅助声明与浓度审查
{flash_result.get('ai_assessment', '系统未检测到明显 AI 痕迹。')}""" + cls._render_risks(risks)

    # =========================================================
    # 主入口
    # =========================================================

    @classmethod
    async def evaluate_visual_work(
        cls,
        flash_model: str,
        pro_model: str,
        image_type: str,
        image_urls: list,
        work_text: str = "",
        has_declared_ai: bool = False,
        use_pro: bool = False,
        page_format: str = "single"   # 'single' 单页 / 'spread' 跨页合图（绘本专属）
    ) -> str:
        """主入口（带全站并发闸）：同一时刻最多 VISION_EVAL_CONCURRENCY 个视觉评审在跑，其余排队；
        排队超时提示繁忙，不扣费。"""
        try:
            await asyncio.wait_for(_EVAL_SEM.acquire(), timeout=EVAL_QUEUE_TIMEOUT)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=503,
                detail="当前评审人数较多，系统繁忙，请稍后再试（本次未扣额度）。"
            )
        try:
            return await cls._evaluate_visual_work_impl(
                flash_model, pro_model, image_type, image_urls,
                work_text, has_declared_ai, use_pro, page_format
            )
        finally:
            _EVAL_SEM.release()

    @classmethod
    async def _evaluate_visual_work_impl(
        cls,
        flash_model: str,
        pro_model: str,
        image_type: str,
        image_urls: list,
        work_text: str = "",
        has_declared_ai: bool = False,
        use_pro: bool = False,
        page_format: str = "single"
    ) -> str:
        """
        评审实现。
        - use_pro=False：Flash 一次调用
        - use_pro=True：Flash 快速读图 → Pro 高清深度判词（两次调用）
        内容安全审查和 AI 声明核验均在模型调用前执行，违规时不扣额度。
        """

        # ---- 1. 加载所有图片（Flash 分辨率） ----
        # requests 是同步调用，放到线程里执行，避免阻塞 FastAPI 事件循环
        images_flash = []
        found_ai_fingerprints = set()

        loaded = await cls._load_images(image_urls, FLASH_MAX_DIM)
        unit = "幅" if image_type == "illustration" else "页"
        rejected = []
        for idx, (img, fingerprint, err) in enumerate(loaded, start=1):
            if img:
                if fingerprint:
                    found_ai_fingerprints.add(fingerprint)
                images_flash.append(img)
            else:
                rejected.append(f"· 第 {idx} {unit}：{err}")
        loaded = None

        if rejected:
            # 有图片未通过：不做残缺评审（缺页的绘本分析会失真），直接告知原因，不扣额度
            images_flash.clear()
            raise HTTPException(
                status_code=422,
                detail=(
                    "⚠️ 部分图片未通过上传检查，本次分析未执行，额度不予扣除。\n\n"
                    + "\n".join(rejected)
                    + "\n\n请按提示处理后重新提交。"
                )
            )

        if not images_flash:
            raise ValueError("未能加载任何有效图片，请检查图片链接是否可访问。")

        image_count = len(images_flash)

        # ---- 2. AI 声明强制核验（声明纯原创但查出指纹 → 立即终止） ----
        if not has_declared_ai and found_ai_fingerprints:
            fingerprint_str = "、".join(found_ai_fingerprints)
            raise HTTPException(
                status_code=422,
                detail=(
                    f"⚠️ 提交审核中止\n\n"
                    f"系统在您的图片元数据中检测到 AI 生成器指纹（特征：{fingerprint_str}）。\n\n"
                    f"您在提交时声明该作品为【纯人类原创，未使用 AI 工具】，与检测结果不符。\n\n"
                    f"本次分析已终止，本次额度不予扣除。如您确实使用了 AI 工具进行辅助，"
                    f"请重新提交并如实选择【使用了 AI 工具进行辅助】。"
                )
            )

        # ---- 3. 内容安全前置审查（独立调用，评审前拦截，命中即 422 不扣费） ----
        # 复用已加载的 images_flash（1024px），不重新下载、不占额外内存。
        # 独立成一次专职判断，避免让评审模型"既评画又当裁判"导致漏拦。
        # 只拦色情与未成年人性化；其余敏感内容写入 risks，在报告末尾提示参赛风险
        # 跑两次再合并（与竞赛内容安全复核一致）：两次一致才采用，不一致降为"可能交人工"
        safety_runs = await asyncio.gather(
            cls._check_content_safety(images_flash, flash_model, image_type),
            cls._check_content_safety(images_flash, flash_model, image_type),
        )
        safety_result = cls._merge_safety(list(safety_runs))
        risks = safety_result.get("risks", []) if isinstance(safety_result, dict) else []
        if isinstance(safety_result, dict) and safety_result.get("block"):
            violation_type = safety_result.get("block_type", "sexual_content")
            violation_label = VIOLATION_LABELS.get(violation_type, violation_type)
            raise HTTPException(
                status_code=422,
                detail=(
                    f"⚠️ 提交审核中止\n\n"
                    f"系统在您提交的图片中检测到不适合本平台的内容（{violation_label}）。\n\n"
                    f"本次分析已终止，本次额度不予扣除。"
                    f"如您认为这是误判，请联系人工审核团队。"
                )
            )

        # ---- 4. 构建 Flash 调用内容 ----
        flash_instruction = cls._get_flash_instruction(
            image_type, has_declared_ai, list(found_ai_fingerprints), page_format
        )

        flash_contents = []
        if work_text and work_text.strip():
            label = (
                "创作说明（仅供背景参考，其文采不影响视觉评分）"
                if image_type == "illustration"
                else "作者提供的整体故事说明（请与故事还原结果进行比对分析）"
            )
            flash_contents.append(f"【{label}】：{work_text}\n")

        flash_contents.append(f"以下为本作品全部 {image_count} 幅图片，请全量读取后进行分析：")
        flash_contents.extend(images_flash)

        # ---- 5. Flash 调用 ----
        try:
            flash_res = await generate(flash_model, flash_contents, system_instruction=flash_instruction,
                                       json_mode=True, temperature=0.2)

            if not (flash_res.candidates and flash_res.candidates[0].content.parts):
                raise ValueError("Flash 模型未生成有效内容。")

            flash_result = json.loads(flash_res.text)
            if isinstance(flash_result, list):
                flash_result = flash_result[0] if flash_result else {}
            if not isinstance(flash_result, dict):
                raise ValueError(f"Flash 返回了非预期类型: {type(flash_result).__name__}")

            # 内容安全已在评审前独立拦截，此处不再重复判断

        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Flash 模型未返回标准 JSON 格式。")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Flash 分析失败：{e}")

        # ---- 6. 仅 Flash：直接渲染报告 ----
        if not use_pro:
            return cls._render_flash_report(flash_result, image_type, image_count, risks)

        # ---- 7. Pro 终审：先释放 Flash 分辨率图片，再重新加载高清图片 ----
        images_flash.clear()
        flash_contents.clear()
        loaded_pro = await cls._load_images(image_urls, PRO_MAX_DIM)
        images_pro = [img for img, _, _ in loaded_pro if img]
        loaded_pro = None

        if len(images_pro) < image_count:
            # Pro 高清图缺页，降级返回 Flash 报告（缺页的终审会失真）
            print(f"⚠️ Pro 高清图片仅加载 {len(images_pro)}/{image_count}，降级返回 Flash 报告。")
            images_pro.clear()
            return cls._render_flash_report(flash_result, image_type, image_count, risks)

        # ---- 8. Pro 调用 ----
        pro_instruction = cls._get_pro_instruction(image_type, flash_result)
        pro_contents = [
            f"以下为本作品全部 {len(images_pro)} 幅高清图片，请结合 Flash 初读结论进行深度终审："
        ] + images_pro

        try:
            pro_res = await generate(pro_model, pro_contents, system_instruction=pro_instruction,
                                     json_mode=True, temperature=0.3)
            pro_contents.clear()
            images_pro.clear()

            if not (pro_res.candidates and pro_res.candidates[0].content.parts):
                raise ValueError("Pro 模型未生成有效内容。")

            pro_result = json.loads(pro_res.text)
            if isinstance(pro_result, list):
                pro_result = pro_result[0] if pro_result else {}
            if not isinstance(pro_result, dict):
                raise ValueError(f"Pro 返回了非预期类型: {type(pro_result).__name__}")

        except json.JSONDecodeError:
            # Pro 解析失败，降级返回 Flash 报告
            print("⚠️ Pro 模型未返回标准 JSON，降级返回 Flash 报告。")
            return cls._render_flash_report(flash_result, image_type, image_count, risks)
        except Exception as e:
            print(f"⚠️ Pro 终审失败（{e}），降级返回 Flash 报告。")
            return cls._render_flash_report(flash_result, image_type, image_count, risks)

        # ---- 9. 渲染 Pro 完整报告 ----
        return cls._render_pro_report(flash_result, pro_result, image_type, image_count, risks)
