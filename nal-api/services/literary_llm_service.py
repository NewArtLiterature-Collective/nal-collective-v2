# nal-api/services/literary_llm_service.py
# ============================================================================
# v2（2026-11）：迁移到新版 SDK google-genai 与 Gemini 3.8 Flash
#   - Gemini 2.5 系列 2026-12-01 停用；旧 SDK google.generativeai 已停止维护，且无法设置思考档位
#   - 对外接口（各方法名、参数、返回值、422/500 行为）不变，路由无需修改
#   - 模型写法"模型名@思考档位"；路由传入的旧模型名自动映射：
#       gemini-2.5-pro → gemini-3.8-flash@medium，gemini-2.5-flash → gemini-3.8-flash@low
#   - 写了思考档位的调用不再传 temperature / top_p（3.x 不接受采样参数）
#   - 依赖：pip install -U google-genai；读取环境变量 GEMINI_API_KEY（或 GOOGLE_API_KEY）
# v3（2026-11-09，主编确认）：
#   - 内容安全改为"整本内容研判"（services/content_review.py，与离线引擎 lit_engine cr1 同一套）：
#     整本通读、整体判断；拦截依据的原句须能在正文定位；非干净作品跑两次，拦与不拦一致才采信。
#     线上即时服务：两次不一致补跑第三次按多数定（不转人工）；整本被平台拦截的不予评审；
#     接口异常不再放行，改为请用户稍后重试。违规作品不给评审、不给建议。
#   - 取消凭"文风"判定的 AI 代写 422：风格印象不构成证据（疑罪从无）。报告末尾的 AI 使用参考
#     只写可指认的具体破绽，措辞中性，不下"与声明不符"的结论。
#   - 评审请求本身被平台拦截时，返回明确的 422 提示，而不是笼统的 500。
#   - 删去用户提示中"照着范例格式"的残留句（系统指令明确不提供范例，前后矛盾）。
# ============================================================================
import os
import json
from google import genai
from google.genai import types
from fastapi import HTTPException

try:
    from services import content_review as cr
except ImportError:          # 直接在 services 目录下运行时
    import content_review as cr

# 旧模型名 → 新模型（路由或数据库里仍写旧名时自动换掉，12-01 之后照常可用）
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
        # google-genai 3.x 默认走 v1 接口，预览版模型（如 gemini-3.1-pro-preview）只在 v1beta 上有 → 固定 v1beta
        http = types.HttpOptions(api_version=os.getenv("GOOGLE_GENAI_API_VERSION_PIN", "v1beta"))
        _client = genai.Client(api_key=key, http_options=http) if key else genai.Client(http_options=http)
    return _client


def resolve_model(spec: str):
    """"gemini-3.8-flash@low" → ("gemini-3.8-flash", "low")；旧名先按 LEGACY_MODEL_MAP 换成新模型。"""
    spec = LEGACY_MODEL_MAP.get(str(spec).strip(), str(spec).strip())
    name, _, level = spec.partition("@")
    return name.strip(), (level.strip().lower() or None)


async def generate(spec: str, contents, system_instruction: str = None, json_mode: bool = False, **cfg):
    """统一的异步调用：写了思考档位的设 thinking_level、去掉采样参数；没写的照旧传采样参数。"""
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


def _has_text(res) -> bool:
    return bool(res and res.candidates and res.candidates[0].content and res.candidates[0].content.parts)


class LiteraryLLMService:
    # 预读、AI 代写检测、内容安全分块扫描专用模型（原 gemini-2.5-flash）
    MODEL_ADAPTIVE = os.getenv("NAL_TEXT_FLASH_MODEL", "gemini-3.8-flash@low")

    @classmethod
    async def generate_creative_guide(cls, user_prompt: str, mentor_desc: str, focus_dimensions: str, snippet_rule: str, target_model: str) -> str:
        """
        🚀 创作伴侣模块 (完全兼容计费墙与动态降级)
        """
        expert_standard = f"""
        【核心指导思想】：{mentor_desc}
        【重点发力维度】：你的大纲和试写必须极力展现以下学术特质：{focus_dimensions}。
        """

        creative_sys_inst = f"""你现在是儿童文学领域的金牌创作指导。
        任务：协助作者构思并实打实地提供创作指导与文本打样。
        标准：{expert_standard}

        【试写片段刚性约束】
        {snippet_rule}

        【输出格式要求】
         请严格按以下顺序输出：
        1. 【核心立意升华】：深入剖析主题。
        2. 【人物弧光设定】：主角的心路历程。
        3. 【情节大纲建议】：整体故事走向。
        4. ===片段分割线=== （请务必单起一行输出此分割线）
        5. 【高光片段试写】：严格按照上方的【试写片段刚性约束】执行。如果要求写长片段，要求极强的画面感和文学性，绝不准敷衍！如果要求拦截，请直接说明“本次服务仅提供大纲”。
        """

        try:
            # 思考用的 token 也计入输出上限：写了思考档位的，把上限放宽到 16384，避免长片段被截断
            _, level = resolve_model(target_model)
            res = await generate(
                target_model, user_prompt, system_instruction=creative_sys_inst,
                temperature=0.7, top_p=0.95, max_output_tokens=16384 if level else 8192,
            )
            if _has_text(res):
                return res.text
            else:
                reason = res.candidates[0].finish_reason if res.candidates else "未知"
                raise ValueError(f"模型未生成内容，安全拦截原因: {reason}")
        except Exception as e:
            print(f"🚨 创作引擎调用异常: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @classmethod
    async def _get_adaptive_instruction(cls, current_text: str, base_weights: dict, user_note: str = "") -> str:
        """
        🧠 NAL 核心自适应引擎 (提取文本指纹并动态调权)
        """
        sense_prompt = """你是一个文本特征分析器。请严谨分析该儿童文学文本指标(0.0-1.0)：
        1.fantasy(幻想感) 2.reality(现实/时代感) 3.character(人物心理深度)。
        必须仅输出纯 JSON 格式：{"fantasy": 0.5, "reality": 0.5, "character": 0.5}"""

        try:
            f_res = await generate(
                cls.MODEL_ADAPTIVE, f"{sense_prompt}\n内容：{current_text[:2000]}",
                json_mode=True, temperature=0.1,
            )
            features = json.loads(f_res.text)
        except Exception as e:
            print(f"⚠️ 预读引擎自动降级 (解析失败): {e}")
            features = {"fantasy": 0.5, "reality": 0.5, "character": 0.5}

        adjusted_weights = base_weights.copy()
        sensitivity = 15
        mapping = {
            "fantasy": ["跨界", "共鸣", "幻想", "想象", "诗意", "隐喻", "对位", "意象", "视觉", "分镜", "审美", "张力", "形式", "艺术", "留白", "介入", "童话", "超自然", "虚构"],
            "reality": ["时代", "社会", "技术", "异化", "现实", "真相", "背景", "偏见", "价值观", "文化", "伦理", "生态", "教育", "批判", "成人主义", "意识形态", "显性", "潜意识", "病灶"],
            "character": ["人物", "心理", "契合", "塑造", "成长", "主体", "非人类", "尊严", "读者", "共生", "视角", "动机", "弧光", "自我", "生命本位", "空间", "体验", "共情"]
        }

        for dim in adjusted_weights.keys():
            if any(k in dim for k in mapping["fantasy"]):
                adjusted_weights[dim] = max(1, adjusted_weights[dim] + (features.get('fantasy', 0.5) - 0.5) * sensitivity)
            if any(k in dim for k in mapping["reality"]):
                adjusted_weights[dim] = max(1, adjusted_weights[dim] + (features.get('reality', 0.5) - 0.5) * sensitivity)
            if any(k in dim for k in mapping["character"]):
                adjusted_weights[dim] = max(1, adjusted_weights[dim] + (features.get('character', 0.5) - 0.5) * sensitivity)

        intervention_log = ""
        if user_note:
            for dim in adjusted_weights.keys():
                if dim[:2] in user_note:
                    adjusted_weights[dim] += 25
                    intervention_log += f"【已根据备注强化‘{dim}’】 "

        total = sum(adjusted_weights.values())
        final_weights = {k: round((v/total)*100, 1) for k, v in adjusted_weights.items()}
        weight_desc = "\n".join([f"- {k}: {v}%" for k, v in final_weights.items()])
        
        return f"""
        ---
        【内部权重参数（仅用于计算维度配比，不要写进判词，也不要使用这里的标签化措辞）】
        文本倾向：幻想({features.get('fantasy')})，现实({features.get('reality')})，人物({features.get('character')})
        {intervention_log}
        各维度配比：
        {weight_desc}
        ---
        按以上配比分配各维度权重执行评审。以上参数不对外呈现。"""

    @staticmethod
    def _build_detection_excerpt(text: str, budget: int = 9000) -> str:
        """为 AI 代写检测构造代表性片段：短文全取，长文取 头+中+尾，便于判断痕迹是否贯穿全文。"""
        text = text or ""
        if len(text) <= budget:
            return text
        seg = budget // 3
        head = text[:seg]
        mid_start = max(0, len(text) // 2 - seg // 2)
        mid = text[mid_start:mid_start + seg]
        tail = text[-seg:]
        return f"{head}\n……（中段节选）……\n{mid}\n……（尾段节选）……\n{tail}"

    @staticmethod
    def _norm_confidence(v) -> str:
        """把模型可能返回的中英文/大小写置信度统一成 high/medium/low（含"极高/很高/非常高"等变体）。"""
        s = str(v if v is not None else "").strip().lower()
        # 先按子串兜底，覆盖"极高/很高/非常高/偏高""very high/strong"等写法
        if "high" in s or "强" in s or "确凿" in s or "极高" in s or "很高" in s or "非常高" in s:
            return "high"
        if "高" in s:   # 兜底："高""偏高"等
            return "high"
        if "medium" in s or "mid" in s or "中等" in s or "一般" in s:
            return "medium"
        if s == "中":
            return "medium"
        return "low"

    @staticmethod
    def _is_affirmative(v) -> bool:
        """把模型可能返回的 bool / 'true' / '是' / 'yes' 统一成布尔真。"""
        if isinstance(v, bool):
            return v
        return str(v if v is not None else "").strip().lower() in (
            "true", "yes", "y", "1", "是", "存在", "疑似", "确认"
        )

    # ⏸ 2026-11-09 起不再调用：凭文风判定 AI 代写不构成证据（疑罪从无）。保留代码仅供对照。
    @classmethod
    async def _check_ai_authenticity(cls, raw_text: str) -> dict:
        """
        🕵️ 独立的 AI 代写前置检测（仅在作者声明"未使用 AI"时调用）。
        专职一件事：判断是否为 AI 代写，不掺杂评审，避免"既当运动员又当裁判"导致中止失效。
        返回 {"ai_ghostwritten": bool, "confidence": "high|medium|low", "evidence": str}
        门槛设高：只有痕迹强、贯穿全文、几乎无人类个人印记时才给 high。
        """
        # 读近乎全文（长篇多章的"每章结尾升华"等模型腔需看到多章才识别得稳；
        # gemini-flash 上下文足够，检测准确比省 token 更重要）
        excerpt = cls._build_detection_excerpt(raw_text, budget=40000)

        detect_prompt = """你是一个严谨的 AI 代写检测器，服务于一个儿童文学评奖平台。作者已声明本文为"纯人类原创，未使用 AI 工具"。你的任务是判断这一声明是否属实。

【最重要的判定原则——先读这条】
判断依据是文本里【是否存在】贯穿全文的结构性 AI 惯性，【不是】看它有没有人类式的细节。
⚠️ 特别注意：文本中出现生动、具体、有生活质感的细节（例如某种食物、某个手工物件、某段温情场景），【绝不能】据此判为人类原创。当代大模型完全有能力生成这类细节，这正是它们的强项。真正区分人与 AI 的是行文的结构性惯性，而非有没有细节。请不要被几处动人的细节"洗白"了对整体结构的判断。

【强结构性 AI 惯性信号（这些是判 high 的正面依据）】
A. 几乎每一章／每一节的结尾都用一句极短的断句强行升华或制造悬念（如"大概叫——活着""危险等级：最高""我不是机器。我是人。"），形成贯穿全篇的三段式模型腔。
B. 模板化的收尾／过渡句，如"故事到这里，按理说应该结束了。但……""如果你问我……那我会说……"这类大模型高触发率的套路句。
C. 情感长期靠直接宣告完成（"我放声大哭""所有的情感像洪水一样涌了进来""我的声音平静得不正常"），而非靠人物下意识的动作或可感的细节推出。
D. 大段并列罗列（情绪名词罗列、精确数字罗列）却缺乏环境氛围与个人语感，呈现算法式的工整。
E. 通篇反复依赖同一种机械句式（如"不是……而是……"）却无实质推进。

【判定规则】
- 命中上述信号中的【两类及以上】，且在多章／多处反复出现（贯穿全文）→ ai_ghostwritten=true，confidence="high"。
- 只命中一类，或信号零散、不成规模 → ai_ghostwritten=true/false 视情况，confidence 至多 "medium"。
- 文本只是文笔干净、结构工整、用词规范，但【没有】上述结构性惯性；或是应试作文腔、翻译腔、非母语但通顺的写作 → ai_ghostwritten=false，confidence="low"。这是为了保护真实的人类作品，宁可放过。

关键区别：真实的人类长篇稿，即使工整，也【不会】同时、反复地命中 A/B/C/D 多类惯性；而 AI 深度生成或按大纲扩写的稿件，往往多章整齐地命中其中好几类。请据此区分，不要因为"写得像真人""有感人细节"就压低判断。

只输出纯 JSON。confidence 字段只许填英文小写 high / medium / low（不要用中文，也不要用"极高/很高"等变体）：
{"ai_ghostwritten": true, "confidence": "high", "evidence": "40-90字，点名你命中了上面哪几类信号（如 A、C），并各举一处原文为证"}"""

        try:
            res = await generate(
                cls.MODEL_ADAPTIVE,
                f"{detect_prompt}\n\n【待检测文本（长文为头/中/尾节选）】：\n{excerpt}",
                json_mode=True, temperature=0.1,
            )
            data = json.loads(res.text)
            if isinstance(data, list):
                data = data[0] if data else {}
            if not isinstance(data, dict):
                return {"ai_ghostwritten": False, "confidence": "low", "evidence": ""}
            return data
        except Exception as e:
            print(f"⚠️ AI 代写前置检测降级（默认放行）: {e}")
            return {"ai_ghostwritten": False, "confidence": "low", "evidence": ""}

    # 旧版切块审查参数（2026-11-09 起改为整本内容研判，见 services/content_review.py；保留仅供对照）
    SAFETY_CHUNK_SIZE = 12000
    SAFETY_CHUNK_OVERLAP = 600

    @classmethod
    def _chunk_text(cls, text: str, size: int, overlap: int) -> list:
        """把全文切成带重叠的块（重叠防止违规句恰好被切在块边界而漏判）。"""
        text = text or ""
        if not text.strip():
            return []
        if len(text) <= size:
            return [text]
        step = max(1, size - overlap)
        chunks, i = [], 0
        while i < len(text):
            chunks.append(text[i:i + size])
            if i + size >= len(text):
                break
            i += step
        return chunks

    @classmethod
    async def _check_content_safety(cls, raw_text: str) -> dict:
        """
        整本内容研判（独立前置，只做内容判断，不掺评审）。实现见 services/content_review.py。
        返回 content_review 的结果：decision ∈ pass / flag / hold / platform / disagree / error。
        """
        async def gen(contents, system_instruction, **cfg):
            return await generate(cls.MODEL_ADAPTIVE, contents, system_instruction=system_instruction,
                                  json_mode=True, **cfg)
        try:
            return await cr.review_text(raw_text, gen, tiebreak=True)
        except Exception as e:
            print(f"⚠️ 整本内容研判异常: {e}")
            return {"decision": "error", "diag": str(e)[:200]}

    @staticmethod
    def _content_notice(review: dict) -> str:
        """判为"标注"（零星越线、不阻断）时附在报告末尾的提示；其余情况返回空串。"""
        final = (review or {}).get("final") or {}
        if review.get("decision") != "flag" or not final.get("flag"):
            return ""
        lines = ["\n\n### ⚠️ 内容提示",
                 "以下几处在内容研判中被认为对 10 岁以上的青少年读者不太合适，不影响本次评审，供修改时参考："]
        for i in final["flag"][:6]:
            lines.append(f"- {cr.issue_line(i)}")
        return "\n".join(lines)

    @classmethod
    async def evaluate_work(cls, raw_text: str, selected_model: str, base_weights: dict, model_system_instruction: str, user_note: str, target_model: str, has_declared_ai: bool = False, is_contest: bool = False) -> str:
        """
        ⚖️ 深度学术评审系统 (融合 AI 痕迹筛查与动态惩罚)
        """
        # ==========================================
        # 🆕 内容安全前置闸（独立调用，最高优先级，代码强制执行）
        # 对所有文字都查，不分声明。命中违规 → 评审前直接 422，不扣费。
        # 独立成一次专职判断，避免让评审模型"既评审又当裁判"导致漏拦。
        # ==========================================
        review = await cls._check_content_safety(raw_text)
        decision = (review or {}).get("decision")
        if decision == "hold":
            label = cr.hold_label(review.get("final"))
            raise HTTPException(
                status_code=422,
                detail=(
                    f"⚠️ 提交审核中止\n\n"
                    f"系统通读全文后认为，本作品含有不适合青少年读者的内容（{label}）。\n\n"
                    f"本次分析已终止，本次额度不予扣除。"
                    f"如您认为这是误判，请联系人工审核团队。"
                )
            )
        if decision == "platform":
            print(f"⚠️ 整本内容研判被平台拦截：{review.get('diag', '')}")
            raise HTTPException(
                status_code=422,
                detail=(
                    "⚠️ 提交审核中止\n\n"
                    "本作品未能通过平台的内容审核，无法进行评审。\n\n"
                    "本次分析已终止，本次额度不予扣除。如您认为这是误判，请联系人工审核团队。"
                )
            )
        if decision in ("error", "disagree"):
            print(f"⚠️ 整本内容研判失败：{review.get('diag', '')}")
            raise HTTPException(
                status_code=503,
                detail="内容研判服务暂时不可用，请稍后重试。本次额度不予扣除。"
            )
        content_notice = cls._content_notice(review)

        # AI 代写：不再前置拦截（2026-11-09）。文风印象不构成证据；AI 使用情况只在报告末尾作中性参考。
        # 列出维度清单供模型逐项评定（不提供范例句，避免模型照抄空洞句式）
        dims_list = "、".join(base_weights.keys())
        dims_lines = ""
        for k, v in base_weights.items():
            dims_lines += f"- {k}（本项满分 {v} 分）\n"

        # 针对不同场景设定不同的 AI 检测规则
        ai_detection_policy = ""
        if is_contest:
            ai_detection_policy = f"""
        【大赛 AI 使用核查】
        作者的 AI 辅助声明状态为：{ '【已声明使用】' if has_declared_ai else '【未声明使用】' }。
        在报告末尾新增 `### 🤖 AI 使用参考` 一节，供人工参考，不构成认定。
        1. "读起来像 AI""文风工整""模型腔"这类风格印象不是证据，不要据此下结论，也不要写"与声明不符"。
        2. 只写可以指认的具体破绽，并引原文为证：如残留的提示语或模型自称、前后自相矛盾的事实、明显是生成工具留下的格式痕迹。没有就写"未见可指认的 AI 使用痕迹"。
        3. 若作者已声明使用，AI 辅助本身不扣分；评判的是成品的文学完成度。"""
        else:
            ai_detection_policy = """
        【AI 使用参考评估】
        在报告末尾新增 `### 🤖 AI 使用参考评估` 一节。
        这一节供作者参考，不构成认定。只写可以指认、能引原文为证的具体现象（如残留的提示语或模型自称、前后自相矛盾的事实、空泛概括句成片出现的段落），不凭"像不像 AI"的整体印象下结论。没有就如实写"未见可指认的 AI 使用痕迹"，不必为凑内容而硬挑毛病。"""

        eval_sys_inst = f"""你现在是 NAL 数字化平台的顶级学术评审专家。

        （内容安全已在评审前由独立环节完成审核，此处无需再做内容安全判断，专注文学评审即可。）

        当前执行的评审体系：【{selected_model}】
        评审维度与各自满分：
        {dims_lines}
        四个维度的单项得分相加，等于最终综合评分（满分 100）。

        【你是谁】
        你是一位资深的儿童文学编辑与评论者。你的判词写给作者本人看——他要靠它判断作品好在哪、弱在哪、下一步怎么改。
        真正的专业体现在判断的准确和依据的扎实，不在词汇的艰深。一位真懂行的人说一部作品好，会说清好在哪一处、这一处为什么难、换个平庸的写法会怎样；说不好，会指出是哪个环节塌了、塌在哪里、根子是什么。

        【判词的三条铁律】（贯穿全文，每一句评价都要遵守）
        一、落到具体处：每一句判断都要咬住作品里的具体对象——某一段、某个情节、某句话、某处对话、某个转折。泛泛而论、放到任何作品上都成立的话，不要写。
        二、讲清为什么：不要停在"立意深刻""语言细腻"这类结论上。要说清因为什么（具体现象）、所以得出什么判断。让作者看得到你的眼光落在哪里。遇到形容词，后面必须跟上"体现在哪里"。
        三、术语为判断服务：只有当某个专业概念此刻最能一针见血时才用它，且用完立刻用一句话说清它在这部作品里具体指什么。为显得专业而堆砌术语，是不专业的表现，明确禁止。

        【语气】
        客观、中肯、就事论事。好就是好，不好就是不好，不夸大也不打压。不使用"严厉""熔断""红线"这类威慑性措辞——评委的分量来自判断本身。

        {ai_detection_policy}

        【评审前先做两件核查】
        1. 逻辑与事实：梳理故事内在逻辑，指出具体的漏洞或自相矛盾之处（若有）。
        2. 原创性：判断是否落入现成套路，若有，指出是哪一类套路、体现在哪个情节。

        【输出格式】
        直接输出评审报告，按以下结构，但每一节的内容都要落实三条铁律：

        ### 💡 逻辑与原创性审查
        - 事实与逻辑：指出具体的逻辑问题或确认其自洽，点明依据的情节。
        - 原创性：X/10 分，说明理由时指出具体的套路或新意所在。

        ### 🧮 维度解析与单项得分
        逐项评定下列维度，每项给出"分数 / 满分"，后面跟一段评语。评语必须引作品里的具体文字或情节为据，说清这个分数是怎么来的——高在哪一处、若未满分则差在哪一处。四项得分之和等于综合评分。
        维度：{dims_list}

        ### 📝 核心修改建议
        给出 2-4 条可执行的建议。每条都要针对作品中一个具体的问题点（指明在哪里），说清怎么改、改了之后会解决什么。不写放之四海而皆准的空泛建议。

        ### 📊 综合学术评分：[总分]/100

        （报告末尾按上文要求补充 AI 使用参考一节）
        """

        adaptive_inst = await cls._get_adaptive_instruction(raw_text, base_weights, user_note)
        combined_instruction = adaptive_inst + "\n\n" + eval_sys_inst
        
        try:
            prompt = f"【评审特定方向引导】：{model_system_instruction}\n【需要评审的作品内容】：\n{raw_text}\n\n【评委备注】：{user_note if user_note else '无'}\n\n请严格按 System Instruction 中的输出结构完成评审，给出真实的打分数字。"
            
            res = await generate(target_model, prompt, system_instruction=combined_instruction, temperature=0.2)

            if _has_text(res):
                result_text = res.text.strip()
                # 内容研判已在评审前完成；判为"标注"的，在报告末尾附内容提示
                return result_text + content_notice
            if cr.platform_blocked(res):
                print(f"⚠️ 评审请求被平台拦截：{cr.diag(res)}")
                raise HTTPException(
                    status_code=422,
                    detail=("⚠️ 提交审核中止\n\n本作品未能通过平台的内容审核，无法进行评审。"
                            "\n\n本次额度不予扣除。如您认为这是误判，请联系人工审核团队。"))
            raise ValueError("模型未返回有效文本。")

        except HTTPException:
            # 前置核查的 422（内容违规 / AI 声明不符）必须原样向上抛，不能被转成 500
            raise
        except Exception as e:
            print(f"🚨 评审引擎调用异常: {e}")
            raise HTTPException(status_code=500, detail=str(e))
