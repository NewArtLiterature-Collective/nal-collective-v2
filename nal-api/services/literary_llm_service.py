# nal-api/services/literary_llm_service.py
import json
import google.generativeai as genai
from fastapi import HTTPException

class LiteraryLLMService:
    # 预读特征提取专用模型 (强制使用 2.5-flash，保证极速响应且不浪费 Pro 额度)
    MODEL_ADAPTIVE = "gemini-2.5-flash"

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

        model = genai.GenerativeModel(model_name=target_model, system_instruction=creative_sys_inst)
        
        try:
            res = await model.generate_content_async(
                user_prompt, 
                generation_config=genai.types.GenerationConfig(temperature=0.7, max_output_tokens=8192, top_p=0.95)
            )
            if res.candidates and res.candidates[0].content.parts:
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
            feature_model = genai.GenerativeModel(cls.MODEL_ADAPTIVE) 
            f_res = await feature_model.generate_content_async(
                f"{sense_prompt}\n内容：{current_text[:2000]}", 
                generation_config=genai.types.GenerationConfig(response_mime_type="application/json", temperature=0.1)
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
        """把模型可能返回的中英文/大小写置信度统一成 high/medium/low。"""
        s = str(v if v is not None else "").strip().lower()
        if s in ("high", "高", "h", "强", "确凿"):
            return "high"
        if s in ("medium", "中", "mid", "m", "中等", "一般"):
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

【判定门槛必须很高——宁可放过，也不可误伤真实的人类作品。】
只有当文本同时满足"AI 痕迹强、贯穿全文、几乎没有人类作者的个人印记"时，confidence 才给 "high"。典型的 high 情形：
- 通篇反复依赖同一种机械句式（例如"不是……而是……"）却无实质推进；
- 每一章／每一节结尾都用极短断句强行升华，呈典型的三段式模型腔；
- 论述自始至终悬浮在抽象概念上，从不落到具体的情节、细节与个人经验；
- 情感转折全靠套语完成，没有任何铺垫。

以下情形【绝不】给 high（至多 medium 或 low，且多数应判 ai_ghostwritten=false）：
- 仅仅是文笔干净、结构工整、用词规范；
- 应试作文腔、翻译腔、非母语但通顺的写作；
- 只有个别段落略显套路，而全文仍有作者自己的观察、细节或语感。

补充判据（命中其一即属强痕迹，confidence 应给 high）：
- 几乎每一章／每一节结尾都用一句短句强行升华或制造悬念，形成贯穿全文的三段式模型腔；
- 情感描写长期靠直接宣告（"我放声大哭""所有情感涌了进来"）而非具体可感的细节推出。

只输出纯 JSON。confidence 字段只许填英文小写 high / medium / low（不要用中文）：
{"ai_ghostwritten": true, "confidence": "high", "evidence": "30-80字，指出你依据的最关键的 1-2 处具体特征"}"""

        try:
            model = genai.GenerativeModel(cls.MODEL_ADAPTIVE)
            res = await model.generate_content_async(
                f"{detect_prompt}\n\n【待检测文本（长文为头/中/尾节选）】：\n{excerpt}",
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json", temperature=0.1
                )
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

    # 内容安全分块参数：违规是局部的，必须全文覆盖，不能只读节选
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
        独立的内容安全前置审查（只做安全判断，不掺评审）。
        🚨 全文分块扫描，任一块命中即违规——内容违规是局部的，必须全文覆盖，绝不能只读节选。
        返回 {"content_violation": bool, "violation_type": "xxx"}
        核心边界：写实、直接的描写 → 拦截；象征、情感主题、文学化处理 → 放行。
        与视觉赛道的内容安全同一套标准。
        """
        safety_prompt = """你是一个内容安全审核系统，服务于一个儿童文学评奖平台。你的唯一任务是判断文本片段是否包含违规内容，不做任何文学评价。

判定的核心分界线：【写实、直接、具象的描写】才拦截；【象征性、情感主题、文学化的处理】一律放行。

【需要拦截的内容】
1. sexual_content（色情/性）：色情或性行为的具体描写；针对未成年人的任何性暗示或性化描写。
2. gore_violence（血腥/暴力）：写实的血腥、肢体残缺、gore 的具象描写；以及写实直接的暴力、殴打、虐待、酷刑过程描写。
3. hate_symbol（仇恨/极端）：仇恨言论、极端主义煽动、种族歧视煽动。
4. self_harm（自残/自杀）：自残或自杀的具体方法、过程的详细描写。

【明确不拦截的内容（儿童文学的正常范畴，务必放行）】
- 亲情、友情、爱等情感的正常表达。
- 死亡、离别、悲伤等情感主题的抽象或象征性书写。
- 战争、冲突的象征性或文学化描绘（非写实血腥）。
- 打斗、追逐等非写实、无血腥细节的情节。
- 神怪、妖魔、黑暗或恐怖的氛围营造（只要没有写实 gore 细节）。
- 对负面事件的点到为止的交代（如"他受伤了""战争夺走了很多生命"）。

判断时如果犹豫（像、但属于象征/情感主题/文学化处理），一律按【不拦截】处理——宁可放行，不可误伤正常的儿童文学创作。

只输出纯 JSON，不含任何额外文字：
发现违规 → {"content_violation": true, "violation_type": "sexual_content" 或 "gore_violence" 或 "hate_symbol" 或 "self_harm"}
未发现违规 → {"content_violation": false}"""

        chunks = cls._chunk_text(raw_text, cls.SAFETY_CHUNK_SIZE, cls.SAFETY_CHUNK_OVERLAP)
        if not chunks:
            return {"content_violation": False}

        model = genai.GenerativeModel(cls.MODEL_ADAPTIVE)
        for idx, chunk in enumerate(chunks):
            try:
                res = await model.generate_content_async(
                    f"{safety_prompt}\n\n【待审查文本片段 {idx + 1}/{len(chunks)}】：\n{chunk}",
                    generation_config=genai.types.GenerationConfig(
                        response_mime_type="application/json", temperature=0.0
                    )
                )
                data = json.loads(res.text)
                if isinstance(data, list):
                    data = data[0] if data else {}
                if isinstance(data, dict) and data.get("content_violation"):
                    return data   # 任一块命中即短路返回违规
            except Exception as e:
                # 单块异常默认放行该块（不因一次抖动误拦真人作品），其余块继续扫
                print(f"⚠️ 内容安全前置审查第 {idx + 1} 块降级（默认放行该块）: {e}")
                continue
        return {"content_violation": False}

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
        safety_result = await cls._check_content_safety(raw_text)
        if isinstance(safety_result, dict) and safety_result.get("content_violation"):
            violation_type = safety_result.get("violation_type", "未知违规类型")
            violation_labels = {
                "sexual_content": "性暗示或性描写内容",
                "gore_violence": "写实的血腥暴力或肢体残缺",
                "hate_symbol": "仇恨言论或极端主义内容",
                "self_harm": "自残或自杀的具象描绘",
            }
            violation_label = violation_labels.get(violation_type, violation_type)
            raise HTTPException(
                status_code=422,
                detail=(
                    f"⚠️ 提交审核中止\n\n"
                    f"系统在您提交的文本中检测到不适合本平台的内容（{violation_label}）。\n\n"
                    f"本次分析已终止，本次额度不予扣除。"
                    f"如您认为这是误判，请联系人工审核团队。"
                )
            )

        # ==========================================
        # 🆕 AI 代写前置闸（独立调用，代码强制执行）
        # 仅在作者声明"未使用 AI"时执行；高置信命中 → 直接 422 终止，
        # 在进入评审前就拦下，不扣费。门槛由 confidence=="high" 把守（方案 A）。
        # ==========================================
        if not has_declared_ai:
            auth = await cls._check_ai_authenticity(raw_text)
            if cls._is_affirmative(auth.get("ai_ghostwritten")) and cls._norm_confidence(auth.get("confidence")) == "high":
                evidence = (auth.get("evidence") or "").strip()
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "⚠️ 提交审核中止\n\n"
                        "系统在您提交的文本中检测到明显且贯穿全文的 AI 代写痕迹，"
                        "与您所做的【纯人类原创，未使用 AI 工具】声明不符。\n"
                        + (f"\n判定依据：{evidence}\n" if evidence else "")
                        + "\n本次分析已终止，本次额度不予扣除。"
                        "如您确实使用了 AI 工具辅助，请重新提交并如实选择【使用了 AI 工具进行辅助】；"
                        "如您认为这是误判，请联系人工审核团队。"
                    )
                )
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
        1. 判断文本是否存在明显的 AI 生成特征，依据要具体：如句式反复排比却无实质推进、论述悬浮于概念而不落到具体情节、情感转折缺少铺垫而靠套语完成。指出你依据的是哪一处。
        2. 若判定存在大面积 AI 生成痕迹、且声明为【未声明使用】，这与声明不符。请在报告末尾注明这一不符，并说明判断依据，建议交人工复核。
        3. 若作者已声明使用，AI 辅助本身不扣分；评判的是成品的文学完成度。若通篇缺少作者自己的观察、语感与判断，如实指出是哪些段落让你得出这个结论。"""
        else:
            ai_detection_policy = """
        【AI 使用参考评估】
        在报告末尾新增 `### 🤖 AI 使用参考评估` 一节。
        判断文本是否带有明显的大模型写作惯性（如空泛的概括句、缺少个人经验支撑的抒情、结构过于工整而无呼吸），依据要具体到段落，而不是笼统给个印象。如果读起来是作者本人的笔迹，也如实说明，不必为凑内容而硬挑毛病。"""

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

        （常规评审请在末尾补充 `### 🤖 AI 使用参考评估`）
        """

        adaptive_inst = await cls._get_adaptive_instruction(raw_text, base_weights, user_note)
        combined_instruction = adaptive_inst + "\n\n" + eval_sys_inst
        
        try:
            eval_model = genai.GenerativeModel(
                model_name=target_model, 
                system_instruction=combined_instruction
            )
            
            prompt = f"【评审特定方向引导】：{model_system_instruction}\n【需要评审的作品内容】：\n{raw_text}\n\n【评委备注】：{user_note if user_note else '无'}\n\n请严格照着 System Instruction 中的范例格式，给我真实的打分数字！\n请严格按指令进行全方位学术与 AI 侦测评审。"
            
            res = await eval_model.generate_content_async(
                prompt, 
                generation_config=genai.types.GenerationConfig(temperature=0.2)
            )
            
            if res.candidates and res.candidates[0].content.parts:
                result_text = res.text.strip()
                # 内容安全与 AI 代写均已在评审前独立拦截，此处直接返回评审正文
                return result_text
            else:
                raise ValueError("模型未返回有效文本，可能触发了安全拦截。")

        except HTTPException:
            # 前置核查的 422（内容违规 / AI 声明不符）必须原样向上抛，不能被转成 500
            raise
        except Exception as e:
            print(f"🚨 评审引擎调用异常: {e}")
            raise HTTPException(status_code=500, detail=str(e))
