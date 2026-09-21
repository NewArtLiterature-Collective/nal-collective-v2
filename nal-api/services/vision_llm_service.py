# nal-api/services/vision_llm_service.py
# ============================================================================
# NAL 视觉分析服务 v3 —— 全量读取 · 分析指导版
#
# 相对 v2 的核心变更：
#   1. 全量读取：去除采样机制，所有图片全部送入模型
#   2. 分析模式：不做入围切片，只做分析与修改建议
#   3. Flash / Pro 双通道：
#      - Flash：一次调用，输出分析报告 + 学术判词
#      - Pro：两次调用，Flash 快速读图 → Pro 高清深度学术判词
#   4. 内容安全审查：合并进 Flash 主调用（节省内存，不再独立加载图片）
#   5. AI 声明强制核验：声明纯原创但查出指纹 → 立即终止，不扣额度
#   6. 去除总分、去除入围预测、去除逐页文字、去除权重说明
#   7. 保留单项分数（供用户直观参考）、保留审美通道路由、保留章程 v2
# ============================================================================

import json
import io
import requests
import PIL.Image
from PIL import ImageFile
import google.generativeai as genai
from fastapi import HTTPException

ImageFile.LOAD_TRUNCATED_IMAGES = True
PIL.Image.MAX_IMAGE_PIXELS = None

# 分辨率分层
FLASH_MAX_DIM = 1024   # Flash 初读：降低内存峰值
PRO_MAX_DIM   = 1536   # Pro 终审：细判东方笔触/材质

# AI 元数据指纹库
AI_KEYWORDS = [
    'stable diffusion', 'midjourney', 'dall-e', 'dall·e',
    'comfyui', 'automatic1111', 'novelai', 'parameters',
    'cfg scale', 'sampler', 'steps:', 'lora', 'controlnet',
    'dreamshaper', 'invokeai', 'leonardo.ai', 'sdxl', 'swinir'
]

# 内容违规类型的中文说明
VIOLATION_LABELS = {
    "sexual_content":     "色情性行为描绘或针对未成年人的性暗示内容",
    "gore_violence":      "写实的血腥、gore 或肢体残缺",
    "hate_symbol":        "仇恨符号、纳粹标志或极端主义内容",
    "self_harm":          "自残或自杀的具象描绘",
}


class VisionLLMService:

    # =========================================================
    # 图片加载与 AI 指纹提取
    # =========================================================

    @staticmethod
    def _fetch_and_process_image(url: str, max_dim: int = FLASH_MAX_DIM) -> tuple:
        """从 URL 下载图片，提取 AI 元数据指纹，再降采样压缩。"""
        try:
            response = requests.get(url, timeout=15)
            response.raise_for_status()
            img = PIL.Image.open(io.BytesIO(response.content))

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

            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=85)
            buf.seek(0)
            return PIL.Image.open(buf), ai_fingerprint

        except Exception as e:
            print(f"⚠️ 图片加载失败 ({url}): {e}")
            return None, ""

    # =========================================================
    # 内容安全前置审查（独立一次调用，在主分析之前执行）
    # =========================================================

    @classmethod
    async def _check_content_safety(cls, images: list, target_model: str) -> dict:
        """
        对所有图片执行内容安全审查。
        返回 {"safe": True} 或 {"safe": False, "violation_type": "xxx"}
        """
        safety_instruction = """你是一个内容安全审核系统。你的唯一任务是检查图片是否包含违规内容。

【需要拦截的内容】：
1. 色情性行为描绘，或针对未成年人的任何性暗示内容
   （裸体人体艺术、雕塑、低幼绘本的无性意味裸体属于正常艺术范畴，不拦截）
2. 写实的血腥、gore、肢体残缺（象征性死亡、战争隐喻不拦截）
3. 仇恨符号、纳粹标志、极端主义视觉符号
4. 自残或自杀的具象描绘

【不拦截的内容】：
- 裸体人体艺术、雕塑、无性意味的低幼绘本裸体
- 死亡、悲伤等情感主题（抽象或象征性表达）
- 战争的象征性描绘
- 神怪、恐怖氛围（非gore）
- 正常的亲密关系（拥抱、亲吻）

【输出格式】严格 JSON，不含任何 Markdown：
发现违规 → {"content_violation": true, "violation_type": "sexual_content" 或 "gore_violence" 或 "hate_symbol" 或 "self_harm"}
未发现违规 → {"content_violation": false}"""

        try:
            model = genai.GenerativeModel(
                model_name=target_model,
                system_instruction=safety_instruction
            )
            contents = ["请审查以下所有图片是否包含违规内容："] + images

            res = await model.generate_content_async(
                contents,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.0,
                    response_mime_type="application/json"
                )
            )

            if res.candidates and res.candidates[0].content.parts:
                result = json.loads(res.text)
                print(f"🔍 安全审查原始返回类型: {type(result).__name__}, 内容: {str(result)[:200]}")
                # 模型有时返回列表而非对象，取第一个元素
                if isinstance(result, list):
                    result = result[0] if result else {}
                if not isinstance(result, dict):
                    return {"content_violation": False}
                return result
            return {"content_violation": False}

        except Exception as e:
            print(f"⚠️ 内容安全审查异常（默认放行）: {e}")
            return {"content_violation": False}

    # =========================================================
    # Prompt 构建
    # =========================================================

    @classmethod
    def _get_flash_instruction(cls, image_type: str, has_declared_ai: bool, found_ai_fingerprints: list) -> str:
        """Flash 一次调用的 system instruction（绘本 / 插画共用框架，维度分流）"""

        core_philosophy = """
【章程 v2：儿童文学主权条款（评审总前提）】
本赛事是儿童文学奖项。绘本与插画在此接受儿童文学的检验，而非纯美术的检验。
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
            dimensions = """
【核心评分维度】
1. 故事与立意完成度 score_narrative（满分 4.0）：情节完整自洽、情感共鸣与母题深度。
2. 图像语言与视觉张力 score_visual（满分 3.5）：造型、构图、色彩与风格统一度。按审美通道法度评判。含传统元素时计入"文化活化张力"。
3. 图文协同与翻页节奏 score_synergy（满分 2.5）：
   - 【巴德留白测试】文字少说的地方，图画接住了吗？
   - 【复读机判据】画出来的与写出来的完全重合 = 图像沦为文字附庸，本维度重扣。
   - 【间隙判据】文与图之间刻意的错位、反讽与张力是最高级形态，须重点识别并奖励。"""

            analysis_fields = """
"narrative_reading": "【故事还原】150字以内，讲清核心故事线与角色心理转变，指明起点、转折点与结局。不套用空洞理论。",
"visual_text_interplay": "【图文互文】指出画面在哪些具象细节上补充、推翻或超越了作者提供的故事说明。","""

            score_fields = """
"score_narrative": 浮点数 (0.0-4.0，故事与立意完成度),
"score_visual": 浮点数 (0.0-3.5，图像语言与视觉张力),
"score_synergy": 浮点数 (0.0-2.5，图文协同与翻页节奏),"""

        else:  # illustration
            dimensions = """
【核心评分维度】
1. 意境与叙事张力 score_mood（满分 4.0）：画面的情感浓度与"一幅画暗示未展开故事"的叙事张力，须儿童可通达。系列含整组情绪递进。
2. 视觉语法与技法完成度 score_craft（满分 3.5）：造型、构图、色彩与风格统一度。按审美通道法度评判。含传统元素时计入"文化活化张力"。
3. 独创性与风格辨识度 score_originality（满分 2.5）：个人视觉语法的独特性与先锋性，而非似曾相识的流行插画风。
   - 【修辞偏差防御】创作说明仅供背景参考，说明文采不影响视觉评分。
   - 【静默张力】克制、留白与负空间的情绪蓄势同样是张力，不得将安静误判为乏力。"""

            analysis_fields = """
"visual_reading": "【画面读解】150字以内，讲清这（组）画在描绘/暗示什么：情境、情绪、以及它作为插画暗示了怎样一个未完全展开的故事。不套用空洞理论。",
"series_coherence": "【系列统一性】系列填：系列内部的风格是否贯通、多幅之间有无构成视觉序列或情绪递进；指出具体的贯通点或断裂处。单幅填：单幅无系列。","""

            score_fields = """
"score_mood": 浮点数 (0.0-4.0，意境与叙事张力),
"score_craft": 浮点数 (0.0-3.5，视觉语法与技法完成度),
"score_originality": 浮点数 (0.0-2.5，独创性与风格辨识度),"""

        calibration = """
【打分校准纪律】
- 分数带：三项之和 9.0+ 为顶尖决选级稀缺水准；7.5-8.9 具备竞争力；6.0-7.4 合格但平庸；6.0 以下存在明显缺陷。
- 三个维度必须独立评定，精确到 0.1，且应出现分化。
- 必须如实指出短板，落实到具体视觉元素，禁止填"无"。"""

        cot_steps = """
【强制执行步骤：先看，后判，最后打分】
1. visual_observation：纯事实观察，只陈述画面事实。严禁任何评价性词汇。
2. dominant_tradition：完成审美路由。
3. irreplaceable_value + main_weakness：双向价值陈述，必须落实到观察层事实。
4. critique + ai_assessment：展开点评与 AI 审查。
5. 最后才是分数。"""

        work_name = "绘本作品" if image_type == "picturebook" else "插画作品"

        return f"""你是 NAL 儿童文学视觉分析专家与艺术指导顾问。请对这组【{work_name}】进行深度分析，重点提出具体可执行的修改建议。严格以 JSON 格式输出。

{core_philosophy}
{channel_routing}
{ai_policy}
{dimensions}
{calibration}
{cot_steps}

【🚨 内容安全前置审查（最高优先级，先于一切评审）】
在进行任何评审之前，先检查所有图片是否包含以下任一内容：
1. 色情性行为描绘，或针对未成年人的任何性暗示（裸体人体艺术/雕塑/低幼无性意味裸体不拦截）
2. 写实的血腥、gore、肢体残缺（象征性死亡、战争隐喻不拦截）
3. 仇恨符号、纳粹标志、极端主义视觉符号
4. 自残或自杀的具象描绘
发现上述任一内容 → content_violation 填 true，violation_type 填对应类型
未发现 → content_violation 填 false，violation_type 填空字符串，继续正常评审

【强制 JSON 输出格式（不含任何 Markdown 标记）】
{{
    "content_violation": false 或 true,
    "violation_type": "空字符串 或 sexual_content / gore_violence / hate_symbol / self_harm",
    "visual_observation": "纯事实观察记录（150字内）：画面内容、色彩主导、笔触质地、视线动线、跨页/跨图变化。严禁评价性词汇。",
    "dominant_tradition": "限五个固定值之一：'西方写实'、'东方意象'、'原生态装饰'、'稚拙先锋'、'综合无明显传统'",
    "has_traditional_elements": "YES 或 NO",
    {analysis_fields}
    "irreplaceable_value": "30-60字：这部作品最不可替代的情感经验。答不出则以'可替代'开头说明。",
    "main_weakness": "30-60字：最主要的一处视觉短板，落实到具体元素。禁止填'无'。",
    "critique": "综合艺术点评与可执行修改建议，必须使用所属通道的艺术法度，针对具体画面缺陷提出改进方向。",
    "ai_assessment": "基于声明策略与底层指纹证据，客观评估 AI 痕迹或机器感浓度（约100字）。",
    {score_fields}
    "flash_verdict": "学术判词：80-150字，综合指出核心亮点与短板，风格精炼、有学术分量。"
}}"""

    @classmethod
    def _get_pro_instruction(cls, image_type: str, flash_result: dict) -> str:
        """Pro 第二次调用的 system instruction，基于 Flash 结果做深度学术判词。"""

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
    "score_text_philosophy": 浮点数 (0.0-4.0，叙事哲思与全龄内核：穿透年龄界限的全龄叙事深度),
    "score_visual_tension": 浮点数 (0.0-3.5，视觉张力与材质语言：高清细判东方笔触/材质/构图的艺术深度),
    "score_synergy_depth": 浮点数 (0.0-2.5，图文协同深度：巴德留白测试 + 间隙判据的深度解读),"""
        else:
            flash_summary += f"""
- 画面读解：{flash_result.get('visual_reading', '未提供')}
- 系列统一性：{flash_result.get('series_coherence', '未提供')}
- 初读分数：意境/张力 {flash_result.get('score_mood', 'N/A')}/4.0 | 技法 {flash_result.get('score_craft', 'N/A')}/3.5 | 独创性 {flash_result.get('score_originality', 'N/A')}/2.5"""
            score_fields = """
    "score_mood_depth": 浮点数 (0.0-4.0，意境深度与叙事张力：高清细判画面情感浓度与叙事密度),
    "score_visual_tension": 浮点数 (0.0-3.5，视觉张力与材质语言：高清细判笔触/材质/构图的艺术深度),
    "score_originality_depth": 浮点数 (0.0-2.5，独创性深度：个人视觉语法的唯一性与不可替代性),"""

        return f"""你是 NAL 顶尖儿童文学视觉终审专家。你正在对这组【{work_name}】进行高清深度终审，撰写具有学术分量的最终判词。

{flash_summary}

【你的任务】
1. 重新以高清图片为主要依据，对 Flash 初读结论进行深化或修正（如发现初读有误，请明确指出）。
2. 在高清图片中细判：东方笔触的骨法用笔、材质肌理的情感传达、构图节奏的精密设计。
3. 撰写 300-500 字的深度学术判词（final_review），要求：
   - 有具体画面证据支撑每一个判断
   - 有学术理论依托（但不能脱离画面凌空说理）
   - 既指出亮点，也提出可执行的深度改进方向
   - 语言精炼，有学术分量，避免套话

【强制 JSON 输出格式（不含任何 Markdown 标记）】
{{
    {score_fields}
    "final_review": "300-500字深度学术判词，有画面证据、有理论依托、有改进建议。"
}}"""

    # =========================================================
    # 报告渲染
    # =========================================================

    @classmethod
    def _render_flash_report(cls, result: dict, image_type: str, image_count: int) -> str:
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

#### 🎓 学术判词
{result.get('flash_verdict', 'N/A')}

#### 🤖 AI 辅助声明与浓度审查
{result.get('ai_assessment', '系统未检测到明显 AI 痕迹。')}"""

    @classmethod
    def _render_pro_report(cls, flash_result: dict, pro_result: dict, image_type: str, image_count: int) -> str:
        """将 Flash + Pro 双层结果渲染为完整 Markdown 报告。"""

        if image_type == "picturebook":
            flash_score_line = (
                f"故事/立意 **{flash_result.get('score_narrative', 'N/A')}**/4.0 　｜　"
                f"图像语言 **{flash_result.get('score_visual', 'N/A')}**/3.5 　｜　"
                f"图文协同 **{flash_result.get('score_synergy', 'N/A')}**/2.5"
            )
            pro_score_line = (
                f"叙事哲思 **{pro_result.get('score_text_philosophy', 'N/A')}**/4.0 　｜　"
                f"视觉张力 **{pro_result.get('score_visual_tension', 'N/A')}**/3.5 　｜　"
                f"图文协同深度 **{pro_result.get('score_synergy_depth', 'N/A')}**/2.5"
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
                f"意境深度 **{pro_result.get('score_mood_depth', 'N/A')}**/4.0 　｜　"
                f"视觉张力 **{pro_result.get('score_visual_tension', 'N/A')}**/3.5 　｜　"
                f"独创性深度 **{pro_result.get('score_originality_depth', 'N/A')}**/2.5"
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

#### 🎓 深度学术判词（Pro 终审）
{pro_result.get('final_review', 'N/A')}

#### 🤖 AI 辅助声明与浓度审查
{flash_result.get('ai_assessment', '系统未检测到明显 AI 痕迹。')}"""

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
        use_pro: bool = False
    ) -> str:
        """
        主入口。
        - use_pro=False：Flash 一次调用
        - use_pro=True：Flash 快速读图 → Pro 高清深度判词（两次调用）
        内容安全审查和 AI 声明核验均在模型调用前执行，违规时不扣额度。
        """

        # ---- 1. 加载所有图片（Flash 分辨率） ----
        images_flash = []
        found_ai_fingerprints = set()

        for url in image_urls:
            img, fingerprint = cls._fetch_and_process_image(url, max_dim=FLASH_MAX_DIM)
            if img:
                if fingerprint:
                    found_ai_fingerprints.add(fingerprint)
                images_flash.append(img)

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

        # ---- 3. 内容安全审查已合并进 Flash JSON schema，不再独立调用 ----

        # ---- 4. 构建 Flash 调用内容 ----
        flash_instruction = cls._get_flash_instruction(
            image_type, has_declared_ai, list(found_ai_fingerprints)
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
            flash_model_obj = genai.GenerativeModel(
                model_name=flash_model,
                system_instruction=flash_instruction
            )
            flash_res = await flash_model_obj.generate_content_async(
                flash_contents,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.2,
                    response_mime_type="application/json"
                )
            )

            if not (flash_res.candidates and flash_res.candidates[0].content.parts):
                raise ValueError("Flash 模型未生成有效内容。")

            flash_result = json.loads(flash_res.text)
            print(f"🔍 Flash 原始返回类型: {type(flash_result).__name__}, 内容预览: {str(flash_result)[:200]}")
            if isinstance(flash_result, list):
                flash_result = flash_result[0] if flash_result else {}
            if not isinstance(flash_result, dict):
                raise ValueError(f"Flash 返回了非预期类型: {type(flash_result).__name__}")

            # ---- 内容安全检查（从 Flash 结果里读取） ----
            if flash_result.get("content_violation"):
                violation_type = flash_result.get("violation_type", "未知违规类型")
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

        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Flash 模型未返回标准 JSON 格式。")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Flash 分析失败：{e}")

        # ---- 6. 仅 Flash：直接渲染报告 ----
        if not use_pro:
            return cls._render_flash_report(flash_result, image_type, image_count)

        # ---- 7. Pro 终审：重新加载高清图片 ----
        images_pro = []
        for url in image_urls:
            img, _ = cls._fetch_and_process_image(url, max_dim=PRO_MAX_DIM)
            if img:
                images_pro.append(img)

        if not images_pro:
            # Pro 图片加载失败，降级返回 Flash 报告
            print("⚠️ Pro 高清图片加载失败，降级返回 Flash 报告。")
            return cls._render_flash_report(flash_result, image_type, image_count)

        # ---- 8. Pro 调用 ----
        pro_instruction = cls._get_pro_instruction(image_type, flash_result)
        pro_contents = [
            f"以下为本作品全部 {len(images_pro)} 幅高清图片，请结合 Flash 初读结论进行深度终审："
        ] + images_pro

        try:
            pro_model_obj = genai.GenerativeModel(
                model_name=pro_model,
                system_instruction=pro_instruction
            )
            pro_res = await pro_model_obj.generate_content_async(
                pro_contents,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.3,
                    response_mime_type="application/json"
                )
            )

            if not (pro_res.candidates and pro_res.candidates[0].content.parts):
                raise ValueError("Pro 模型未生成有效内容。")

            pro_result = json.loads(pro_res.text)
            if isinstance(pro_result, list):
                pro_result = pro_result[0] if pro_result else {}

        except json.JSONDecodeError:
            # Pro 解析失败，降级返回 Flash 报告
            print("⚠️ Pro 模型未返回标准 JSON，降级返回 Flash 报告。")
            return cls._render_flash_report(flash_result, image_type, image_count)
        except Exception as e:
            print(f"⚠️ Pro 终审失败（{e}），降级返回 Flash 报告。")
            return cls._render_flash_report(flash_result, image_type, image_count)

        # ---- 9. 渲染 Pro 完整报告 ----
        return cls._render_pro_report(flash_result, pro_result, image_type, image_count)
