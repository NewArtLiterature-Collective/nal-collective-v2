# nal-api/services/vision_llm_service.py
# ============================================================================
# NAL 视觉评审服务 v2 —— 章程 v2（儿童文学主权）版
#
# 本版融入第二届评审系统重建的全部经验：
#   1. 章程 v2：情感真挚浓度与儿童可通达性决定天花板，技法完成度决定地板
#   2. 四通道审美路由（东方意象/西方写实/原生态装饰/稚拙先锋）：
#      水墨留白不再被西式透视法度误杀，通道决定点评所用的艺术法度
#   3. 全局语义冲突豁免（带触发门槛）：观念性荒诞 ≠ 逻辑混乱
#   4. 灵气取证协议：先看后判（纯事实观察层）+ 双向价值陈述
#      （不可替代之处 / 最可替代之处），灵气藏在观察层，不在理论层
#   5. 打分校准纪律：分数带锚定 + 只减不加 + 强制短板 + 论证先于分数
#   6. 绘本分页说明（第三届新格式）：逐页图文对位已是作品本体的一部分，
#      巴德留白测试正式启用；图文咬合信号计入视觉侧，不回流文本权重
#
# 【文本权重约定（供上游合成总分时引用）】
#   绘本：文本(概述/主旨) 20% / 视觉(含图文咬合) 80%
#     —— 分页文字是作品构成成分，其与图画的咬合关系由本服务在视觉侧评审；
#        整体概述仍属代理信号，权重维持 20%。
#   插画：文本(创作说明) 15% / 视觉 85%
#     —— 创作说明是随附文件而非作品成分。本服务明令：说明的文采
#        不得影响视觉评分（修辞偏差防御）。
# ============================================================================
import json
import io
import requests
import PIL.Image
from PIL import ImageFile
import google.generativeai as genai
from fastapi import HTTPException

# 允许加载截断图像，防止个别异常图片导致整个请求崩溃
ImageFile.LOAD_TRUNCATED_IMAGES = True
PIL.Image.MAX_IMAGE_PIXELS = None

# 供上游合成总分引用的赛道文本权重（与离线评审管线口径一致）
TRACK_TEXT_WEIGHTS = {
    "picturebook": 0.20,
    "illustration": 0.15,
}

# 🚨 同步 Pro 脚本的硬核 AI 侦测特征库
AI_KEYWORDS = [
    'stable diffusion', 'midjourney', 'dall-e', 'dall·e',
    'comfyui', 'automatic1111', 'novelai', 'parameters',
    'cfg scale', 'sampler', 'steps:', 'lora', 'controlnet',
    'dreamshaper', 'invokeai', 'leonardo.ai', 'sdxl', 'swinir'
]


class VisionLLMService:

    @staticmethod
    def _fetch_and_process_image(url: str, max_dim=1536) -> tuple[PIL.Image.Image | None, str]:
        """从 URL 下载图片，先极限提取 AI 元数据，再进行降采样压缩"""
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            img = PIL.Image.open(io.BytesIO(response.content))

            # 🚨 在压缩丢失数据前，深度挖掘元数据指纹
            ai_fingerprint = ""
            meta_text = ""

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
                            except:
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
            print(f"⚠️ 图片加载或处理失败 ({url}): {e}")
            return None, ""

    @classmethod
    def _get_v65_instruction(cls, image_type: str, has_declared_ai: bool = False, found_ai_fingerprints: list = None) -> str:
        """
        🚀 NAL 章程 v2 创作指导型视觉评审指令
        （儿童文学主权 + 四通道路由 + 灵气取证 + 校准纪律 + 动态 AI 检测）
        """

        core_philosophy = """
        【章程 v2：儿童文学主权条款（评审总前提）】
        本赛事是儿童文学奖项，不是当代艺术奖。绘本与插画在此接受儿童文学的检验，而非纯美术的检验。
        - 情感的真挚浓度与儿童可通达性，决定作品的天花板；技法完成度决定地板。
        - 观念的锐利与形式的实验，仅在服务于情感传达与儿童经验时构成价值；脱离儿童可通达性的晦涩表达，在本赛事中是缺陷，不是风格。
        - 全龄化指分层可读：儿童读到表层的真与趣，成人读到纵深的思与痛——而非仅面向成人素养的表达。
        - 反平庸条款：平庸的定义是情感的套路化（贺卡式温情、图解式感动、可预期的煽情公式）。套路化的甜腻不应高于笨拙的真挚；真挚的温情——哪怕题材日常、技法朴素——是本赛事的核心价值，不是扣分理由。
        - 材质盾牌：岩彩、拼贴、粗粝蜡笔、手工肌理与数字笔刷同为平等的艺术语言。材质与画面元素的多寡不得作为扣分理由，材质本身也不构成加分理由——加分只来自材质与情感传达的咬合程度。

        【🚨 视觉评审极度警示（必须规避的三大陷阱）】
        1. 警惕「精美陷阱」：视觉极为精美但沦为"画廊展品"。若图画未参与叙事或缺乏文本推进力，必须严厉扣分。
        2. 警惕「视觉人造儿童」：严查画面中是否有将儿童强行宠物化、弱智化的视觉表达。坚决抵制披着低幼外衣的刻板道德说教。
        3. 警惕「图文复读机」：画出来的和写出来的一模一样，毫无文本与图像的博弈和互补空间。
        """

        channel_routing = """
        【🧭 审美路由（先分流，再评审，点评必须使用所属通道的艺术法度）】
        先判定作品的视觉语法属于以下哪一通道，并在 style_channel 字段如实输出。注意：路由依据是画面自身的视觉语法，不是作者声明的媒介——水墨媒介可以承载稚拙语法，数字媒介可以模拟岩彩质感。
        1. 「西方写实」：考核透视、解剖、光影的严谨与突破。
        2. 「东方意象」：以气韵、留白、骨法用笔为法度。大面积留白是呼吸与意境，不是"构图空洞"；散点透视是语法，不是"透视错误"。严禁以西式透视与解剖学苛求本通道作品。
        3. 「原生态装饰」：民间美术、岩彩、剪纸、皮影等传统语汇。平面化与程式化造型是文化基因，不是"造型能力不足"；考核其文化活化的当代转译力。
        4. 「稚拙先锋」：儿童涂鸦感、率真笔触、综合材料实验。稚拙是艺术选择，不是技法缺陷；考核其真诚的生命力与表达的准确性。

        【全局语义冲突豁免（跨通道优先条款）】
        当画面出现高密度的元素跨界并置——古典语境+现代器物、真实材质与手绘的拼贴并置、比例/物种/场景的刻意错乱——且同时满足①跨语境或非常规、②具有系统性设计而非偶然点缀、③承载可辨认的情感或哲思指向时：必须优先判定为"观念性荒诞/隐喻"，关闭所属通道的透视与解剖学红线，转而考核并置的隐喻锐度与情感指向。日常题材中常规元素的普通组合（如现代街景中的传统建筑、儿童故事里的拟人动物）不触发本豁免。
        """

        # 🚨 动态 AI 审查策略与底层证据对撞
        ai_policy = ""
        fingerprint_str = ", ".join(found_ai_fingerprints) if found_ai_fingerprints else ""

        if found_ai_fingerprints and not has_declared_ai:
            ai_policy = f"""
        【🚨 严重违规警告：涉嫌隐瞒 AI 生成】
        创作者声称此为"纯人类原创"。但是，我们的底层系统已在图片元数据中提取到了确凿的 AI 生成器指纹及生成参数（查获核心特征词：[{fingerprint_str}]）。
        你的任务：在 v65_ai_assessment 字段中严厉指出这一瞒报事实，批评其缺乏学术与创作诚信，并在综合评分上给予适当惩罚。
        """
        elif has_declared_ai:
            ai_policy = f"""
        【🤖 视觉指纹筛查策略：已声明 AI 辅助】
        创作者已坦诚使用了 AI 进行辅助（系统同步检出底层特征：[{fingerprint_str if fingerprint_str else '依靠视觉研判'}]）。
        你的任务：包容其工具属性，但必须尖锐地指出其"机器感"浓厚的地方（如：千篇一律的塑料光影、细节逻辑错乱、空间透视崩坏）。指导创作者如何通过人类的主观美学去进行"二次艺术打磨"。
        """
        else:
            ai_policy = """
        【🤖 视觉指纹筛查策略：未声明 AI 辅助，未查出底层指纹】
        创作者声明此为纯原创，底层元数据也未发现已知 AI 标记。请开启极高敏锐度的"AI 痕迹筛查"。
        寻找任何疑似生成式 AI 的典型缺陷（如：毫无逻辑的背景元素融合、过度完美的商业插画质感但情感空洞、角色的细微结构崩坏）。如果有强烈的视觉 AI 痕迹，请在点评中严厉指出。
        """

        # 维度 1：画面艺术性（通道内评审）
        artistry_base = """
        1. 视觉艺术性与完成度 (满分 4.0)：
           - 在其所属审美通道的法度内，评估原创辨识度、色彩/线条/造型的自洽性，是否具有不妥协的艺术尊严？
           - 警惕"朴素偏见"：风格简单不等于缺乏艺术性，重点在于表达的准确性与情感的真挚浓度。
        """

        # 维度 2：情感直达与全龄隐喻（章程 v2 核心维度）
        creativity_advance = """
        2. 情感直达与儿童主体意识 (满分 3.0)：
           - 画面的情感能否不经解说直达儿童？图像是否运用儿童视平线，赋予儿童真正的"主体意识"，而非被成人凝视的客体？
           - 画面中是否预埋了超越表层叙事的视觉隐喻，引发全龄读者的分层共鸣？隐喻须服务于情感，而非需要艺术史素养才能解码的观念装置。
        """

        # 维度 3：叙事引擎 (双轨制分流)
        if image_type == "illustration":
            narrative_advance = """
        3. 单幅叙事张力 (满分 3.0) - 【🎨 插画专属标准】：
           - 重点考核其是否能在单张画面内完成情绪爆发，具备"定格动画"般的瞬间表现力和巨大的空间张力。绝不用"翻页连贯性"苛求单幅插画。
           - 张力包含"静默张力"：克制、留白与负空间的情绪蓄势同样是张力，不得将安静误判为乏力。
           - 【修辞偏差防御】随附的创作说明仅供背景参考：说明写得华丽不加分，写得朴素不扣分——你评的是画，不是文案。
            """
        else:  # 默认为 picturebook
            narrative_advance = """
        3. 图文对位与「第三层故事」 (满分 3.0) - 【📖 绘本专属标准】：
           - 逐页研判图文关系层次（同步/互补/对位/对抗）。
           - 【巴德留白测试】：文字少说、不说的地方，图画接住了吗？图像是否填补了文字的留白？图文合并后，是否产生了超越各自的"第三层故事"？
           - 【复读机判据】：画出来的与写出来的完全重合 = 图像沦为文字附庸，本维度重扣。
           - 【间隙判据】：文与图之间刻意的错位、反讽与张力，是绘本艺术的最高级形态，须重点识别并奖励。
           - 翻页的物理节奏是否被巧妙设计？
            """

        calibration_discipline = """
        【打分校准纪律（凌驾于一切评审倾向之上）】
        - 分数带：9.0 以上为顶尖赛事决选级的稀缺水准，给出前必须在点评中论证其相对于"合格佳作"的超额价值；7.5-8.9 具备入围竞争力；6.0-7.4 合格但平庸；6.0 以下存在明显缺陷。大多数投稿应落在 6.0-8.0 区间。
        - 豁免只减不加：所有通道豁免与语义冲突豁免，只用于关闭错误的扣分维度，绝不构成加分理由。稚拙先锋通道内同样存在平庸的稚拙，东方意象通道内同样存在空洞的留白。
        - 三个维度必须独立评定，精确到 0.1，且应出现分化——一部作品极少在所有维度上同等优秀；3.8/2.8/2.9 一类的近顶默认组合视为未完成评审。
        - 必须如实指出短板（v65_main_weakness），落实到具体视觉元素，禁止填"无"——任何作品都存在相对短板，包括杰作。
        """

        cot_steps = """
        【强制执行步骤（先看，后判，最后打分）】
        你必须按照提供的 JSON 字段顺序依次生成，这个顺序就是你的思考顺序：
        1. visual_observation：先纯粹地看——只陈述画面事实（画了什么、什么颜色主导、笔触是什么质地、视线第一落点在哪、跨图/跨页之间什么在变化）。本字段严禁出现任何评价性词汇（"统一""张力""自洽""先锋"等一律违规）。灵气藏在这一层的细节里，请把它们如实记下。
        2. style_channel：基于观察到的视觉语法完成审美路由。
        3. 双向价值陈述：v65_irreplaceable_value（这部作品提供了什么别处难寻的情感经验——问自己：把它拿走，孩子们失去了什么？）与 v65_main_weakness（最主要的一处具体短板）。两个方向都必须落实到 visual_observation 中出现过的事实。
        4. v65_critique 与 v65_synergy_report：基于以上证据展开点评与陷阱自查，所有判断只准引用观察层记录过的事实。
        5. v65_ai_assessment：客观的 AI 痕迹与浓度评估。
        6. 最后才是分数：三个子维度得分（据前述论证给出），严格相加得出 v65_visual_score，并给出 v65_prediction。
        """

        work_name = "插画作品" if image_type == "illustration" else "绘本作品"

        return f"""你现在是 NAL 顶尖儿童文学视觉评审专家与艺术指导顾问。请严格根据以下标准评审这组【{work_name}】，重点在于提出具体的打磨改进建议，并必须仅以 JSON 格式输出结果。

        {core_philosophy}
        {channel_routing}
        {ai_policy}

        【核心评分维度（4:3:3）】：
        {artistry_base}
        {creativity_advance}
        {narrative_advance}

        {calibration_discipline}
        {cot_steps}

        【强制 JSON 输出格式】
        必须严格按以下字段顺序输出 JSON，不要包含 Markdown 标记：
        {{
            "visual_observation": "纯事实观察记录（150字内）：画面内容、色彩主导、笔触质地、视线动线、跨页/跨图变化。禁止任何评价性词汇。",
            "style_channel": "限四个固定值之一：'西方写实'、'东方意象'、'原生态装饰'、'稚拙先锋'",
            "v65_irreplaceable_value": "30-60字：这部作品最不可替代的一次情感经验是什么。若确实想不出，以'可替代'开头并说明。",
            "v65_main_weakness": "30-60字：最主要的一处视觉短板，落实到具体元素。禁止填'无'。",
            "v65_critique": "集成理论的综合艺术点评，必须使用所属通道的艺术法度，针对画面缺陷提出可执行的修改建议",
            "v65_synergy_report": "包含陷阱自查与画面优缺点理论映射的思维链分析",
            "v65_ai_assessment": "基于 AI 筛查策略与底层指纹证据，客观评估其欺诈行为或机器感浓度，字数约100字。",
            "score_artistry": 浮点数 (0.0-4.0),
            "score_subject": 浮点数 (0.0-3.0),
            "score_narrative": 浮点数 (0.0-3.0),
            "v65_visual_score": 浮点数 (1-10分，前三项的严格加总),
            "v65_prediction": "限制三个固定值之一：'提出修改建议'、'认定是视觉杰作'、'需人工复核'"
        }}
        """

    @classmethod
    async def evaluate_visual_work(
        cls,
        target_model: str,
        image_type: str,
        image_urls: list,
        work_text: str = "",
        page_texts: list = None,
        is_pro: bool = False,
        has_declared_ai: bool = False
    ) -> str:
        MAX_IMAGES = 50 if is_pro else 12
        total_images = len(image_urls)

        if total_images > MAX_IMAGES:
            step = total_images / MAX_IMAGES
            sampled_indices = [int(i * step) for i in range(MAX_IMAGES)]
            if sampled_indices[-1] != total_images - 1:
                sampled_indices[-1] = total_images - 1
            sampled_indices = sorted(set(sampled_indices))  # 🌟 去重防端点碰撞
            is_sampled = True
        else:
            sampled_indices = list(range(total_images))
            is_sampled = False

        processed_pairs = []
        found_ai_fingerprints = set()

        for i in sampled_indices:
            url = image_urls[i]
            img, fingerprint = cls._fetch_and_process_image(url)
            if img:
                if fingerprint:
                    found_ai_fingerprints.add(fingerprint)

                pt_text = ""
                if page_texts is not None:
                    # 🌟 None 元素防御：page_texts[i] 可能为 None
                    raw_pt = page_texts[i] if i < len(page_texts) else None
                    pt_text = (raw_pt or "").strip() or "（本页无文字描述/纯无字分镜）"

                processed_pairs.append({
                    "original_page": i + 1,
                    "image": img,
                    "text": pt_text
                })

        if not processed_pairs:
            raise ValueError("未提取到有效的图片用于视觉评审。")

        system_instruction = cls._get_v65_instruction(image_type, has_declared_ai, list(found_ai_fingerprints))
        contents = []

        # 🌟 采样声明：抽样造成的跨页/跨图跳跃不得判为叙事断裂（《奶奶家的秋》教训）
        if is_sampled:
            contents.append(
                f"【采样声明】作品共 {total_images} 页/幅，以下为系统按叙事节点等距抽取的 {len(processed_pairs)} 个样本（含首末）。"
                f"样本之间的场景跳跃与情节间隔是抽样造成的，严禁据此判定\"叙事断层\"\"风格前后不统一\"；"
                f"请基于这些锚点推断整体叙事弧线与风格自洽性。\n"
            )

        if page_texts is not None and image_type == "picturebook":
            if work_text and work_text.strip():
                contents.append(f"【作品整体故事说明/主旨】: {work_text}\n")

            contents.append(f"【高阶评审模式：逐页图文对位审查】以下为系统从原书中提取的 {len(processed_pairs)} 个跨页/分镜剧本：\n")
            for pair in processed_pairs:
                contents.append(f"--- 📖 原书第 {pair['original_page']} 跨页/分镜 ---")
                contents.append(f"📄 本页文本/剧本: {pair['text']}")
                contents.append(pair['image'])

            contents.append(
                "\n【终审指令】：请严格根据上方逐页映射的图文关系执行巴德留白测试——文字少说的地方，图画接住了吗？"
                "是否存在高级的反讽、对位或互补关系（间隙判据）？警惕图文完全重复的\"复读机\"现象。"
                "逐页文字是作品的构成成分，图文咬合质量直接计入维度三。"
            )

        else:
            if work_text and work_text.strip():
                label = "创作说明（仅供背景参考，其文采不影响视觉评分）" if image_type == "illustration" else "作品整体补充说明"
                contents.append(f"【{label}】: {work_text}")
            for pair in processed_pairs:
                contents.append(pair['image'])

        try:
            model = genai.GenerativeModel(
                model_name=target_model,
                system_instruction=system_instruction
            )

            res = await model.generate_content_async(
                contents,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.2,
                    response_mime_type="application/json"
                )
            )

            if res.candidates and res.candidates[0].content.parts:
                result_json = json.loads(res.text)

                if isinstance(result_json, list):
                    if len(result_json) > 0 and isinstance(result_json[0], dict):
                        result_json = result_json[0]
                    else:
                        raise ValueError("视觉模型返回了非法的空列表或格式错误。")

                artistry = result_json.get('score_artistry', 'N/A')
                subject = result_json.get('score_subject', 'N/A')
                narrative = result_json.get('score_narrative', 'N/A')
                ai_assessment = result_json.get('v65_ai_assessment', '系统未检测到明显的 AI 痕迹。')
                text_weight = TRACK_TEXT_WEIGHTS.get(image_type, 0.2)

                markdown_report = f"""
### 🎨 NAL 视觉艺术评审与指导报告

**📊 综合视觉表现分：{result_json.get('v65_visual_score', 'N/A')} / 10**
*(单项得分明细：艺术质感 {artistry}/4.0 | 情感直达 {subject}/3.0 | 叙事对位 {narrative}/3.0)*

**🧭 审美通道：{result_json.get('style_channel', '未路由')}** | **🔍 评审指导结论：{result_json.get('v65_prediction', 'N/A')}**

---

#### 👁️ 画面观察记录
{result_json.get('visual_observation', 'N/A')}

#### ✨ 不可替代之处
{result_json.get('v65_irreplaceable_value', 'N/A')}

#### 🔧 主要短板
{result_json.get('v65_main_weakness', 'N/A')}

#### 💡 综合评审与修改建议
{result_json.get('v65_critique', 'N/A')}

#### 🔬 理论映射与专项诊断 (陷阱自查与思维链)
{result_json.get('v65_synergy_report', 'N/A')}

#### 🤖 AI 辅助声明记录与浓度审查
{ai_assessment}

---
*本报告为视觉侧评审（该赛道视觉权重 {int((1 - text_weight) * 100)}%，文本权重 {int(text_weight * 100)}%）。*
"""
                return markdown_report
            else:
                raise ValueError("视觉模型未生成有效内容。")

        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="模型未返回标准 JSON 格式。")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
