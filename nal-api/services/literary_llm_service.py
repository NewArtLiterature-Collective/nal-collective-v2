# nal-api/services/literary_llm_service.py
import json
import google.generativeai as genai
from fastapi import HTTPException

class LiteraryLLMService:
    # 预读特征提取专用模型 (强制使用 2.5-flash，保证极速响应)
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
        【NAL 通用自适应校准报告】
        文本指纹：幻想({features.get('fantasy')})，现实({features.get('reality')})，人物({features.get('character')})
        {intervention_log}
        动态权重矩阵：
        {weight_desc}
        ---
        请按此分配执行评审。"""

    @classmethod
    async def evaluate_work(cls, raw_text: str, selected_model: str, base_weights: dict, model_system_instruction: str, user_note: str, target_model: str, has_declared_ai: bool = False, is_contest: bool = False) -> str:
        """
        ⚖️ 深度学术评审系统 (融合 AI 痕迹筛查与动态惩罚)
        """
        example_dims = ""
        for k, v in base_weights.items():
            example_score = int(v * 0.8)
            example_dims += f"* **{k}**：{example_score}/{v}分 - 这里的描写非常生动...\n"

        # 🚨 核心逻辑注入：针对不同场景设定不同的 AI 检测规则
        ai_detection_policy = ""
        if is_contest:
            ai_detection_policy = f"""
        【🚨 大赛 AI 审查红线（刚性执行）】
        创作者前端声明使用 AI 辅助的状态为：{ '【已声明使用】' if has_declared_ai else '【未声明使用】' }。
        1. 必须对文本进行严格的“机器味”逆向侦测。
        2. 如果你判定本文存在大面积 AI 生成痕迹（例如：机械排比、空洞说教、套路化转折），且前端状态为【未声明使用】，此行为构成瞒报欺诈。请在最终评审报告最下方输出【拦截熔断警告】，并强烈建议将作品判定为不合格。
        3. 如果作者已诚实声明使用，允许存在部分 AI 辅助，但依然严禁“通篇交由 AI 代写”。若毫无人类文学质感，请在报告中批评其“缺乏人类作者真实情感介入”。
        """
        else:
            ai_detection_policy = """
        【🔍 常规 AI 浓度评估】
        这是常规评审。请在评审报告的最后，新增一项名为 `### 🤖 创作指纹与 AI 浓度评估` 的模块。
        客观评估本文的“人造感”或是否存在明显的 LLM（大语言模型）写作套路，指出疑似 AI 辅助的段落特征，为创作者提供风格去机核化的建议。
        """

        eval_sys_inst = f"""你现在是 NAL 数字化平台的顶级学术评审专家。
        当前执行的评审体系：【{selected_model}】
        这四个维度的【最高满分】分别是：{base_weights}

        【核心任务】
        阅读用户的作品，进行心算，并输出真实的个位数字分数！绝不允许抄写模板占位符，绝不允许全部打0分！

        {ai_detection_policy}

        【第一阶段：前置硬伤排查】
        1. 逻辑与事实核查：检查故事逻辑漏洞。
        2. 原创性评估：审视是否落入常见套路。

        【强制输出规范】
        请直接输出你的最终评审报告。
        
        ### 💡 逻辑与原创性审查
        * **事实与逻辑排查**：[分析]
        * **原创性评估**：[X/10分]
        
        ### 🧮 维度解析与单项得分
        {example_dims}
        
        ### 📝 核心修改建议
        [提供具体修改建议]

        ### 📊 综合学术评分：[真实总分]/100
        
        （注意：如果你是常规评审，请务必在下方补充 `### 🤖 创作指纹与 AI 浓度评估`）
        """

        adaptive_inst = await cls._get_adaptive_instruction(raw_text, base_weights, user_note)
        combined_instruction = adaptive_inst + "\n\n" + eval_sys_inst
        
        try:
            eval_model = genai.GenerativeModel(
                model_name=target_model, 
                system_instruction=combined_instruction
            )
            
            prompt = f"【评审特定方向引导】：{model_system_instruction}\n【需要评审的作品内容】：\n{raw_text}\n\n【评委备注】：{user_note if user_note else '无'}\n\n请严格按指令进行全方位学术与 AI 侦测评审。"
            
            res = await eval_model.generate_content_async(
                prompt, 
                generation_config=genai.types.GenerationConfig(temperature=0.2)
            )
            
            if res.candidates and res.candidates[0].content.parts:
                return res.text
            else:
                raise ValueError("模型未返回有效文本，可能触发了安全拦截。")
                
        except Exception as e:
            print(f"🚨 评审引擎调用异常: {e}")
            raise HTTPException(status_code=500, detail=str(e))
