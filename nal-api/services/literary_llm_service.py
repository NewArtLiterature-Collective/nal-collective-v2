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

        # 动态注入计费系统传来的字数拦截规则！
        creative_sys_inst = f"""你现在是儿童文学领域的金牌创作指导。
        任务：协助作者构思并提供创作指导。
        标准：{expert_standard}
        
        {snippet_rule}

        【输出格式要求】
        1. 前半部分：包含【核心立意升华】、【人物弧光设定】、【情节大纲建议】。
        2. 如果权限允许试写，中间必须插入一行：===片段分割线===
        3. 后半部分：请严格根据上方【权限拦截】或【权限特供】的要求，决定是否输出试写片段。如果允许输出，必须保证极强的画面感和文学性。
        """

        model = genai.GenerativeModel(
            model_name=target_model, 
            system_instruction=creative_sys_inst
        )
        
        try:
            # 保留 V1 的高创造力配置
            res = await model.generate_content_async(
                user_prompt, 
                generation_config=genai.types.GenerationConfig(
                    temperature=0.7,
                    max_output_tokens=8192,
                    top_p=0.95
                )
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
            # 预读特征提取始终使用轻量级模型
            feature_model = genai.GenerativeModel(cls.MODEL_ADAPTIVE) 
            f_res = await feature_model.generate_content_async(
                f"{sense_prompt}\n内容：{current_text[:2000]}", 
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.1 # 极低温度确保 JSON 结构稳定
                )
            )
            features = json.loads(f_res.text)
        except Exception as e:
            print(f"⚠️ 预读引擎自动降级 (解析失败): {e}")
            features = {"fantasy": 0.5, "reality": 0.5, "character": 0.5}

        # --- 语义指纹感应矩阵 (完美还原 V1) ---
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

        # 人工干预偏置
        intervention_log = ""
        if user_note:
            for dim in adjusted_weights.keys():
                if dim[:2] in user_note:
                    adjusted_weights[dim] += 25
                    intervention_log += f"【已根据备注强化‘{dim}’】 "

        # 归一化
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
    async def evaluate_work(cls, raw_text: str, selected_model: str, base_weights: dict, model_system_instruction: str, user_note: str, target_model: str) -> str:
        """
        ⚖️ 深度学术评审系统 (由计费网关传递具体使用的算力模型)
        """
        # 1. 动态生成高分示范模板 (打破 AI 填空瘫痪)
        example_dims = ""
        for k, v in base_weights.items():
            example_score = int(v * 0.8)
            example_dims += f"* **{k}**：{example_score}/{v}分 - 这里的描写非常生动，完美契合了该维度的要求...\n"

        # 2. 拼接核心强约束指令 (还原 V1 犀利风格)
        eval_sys_inst = f"""你现在是 NAL 数字化平台的顶级学术评审专家。你的评审风格以【犀利、冷峻、见血】著称。
        当前执行的评审体系：【{selected_model}】
        这四个维度的【最高满分】分别是：{base_weights}

        【核心任务】
        你必须像一位严苛但真实的评委，阅读用户的作品，进行心算，并输出真实的个位数字分数！
        绝不允许抄写模板占位符，绝不允许全部打0分！

        【第一阶段：前置硬伤排查】
        1. 逻辑与事实核查：检查故事逻辑漏洞与科学/历史事实准确性。
        2. 原创性评估：审视是否落入常见套路。

        【评审准则：严禁平庸】
        1. 你的默认立场是“寻找瑕疵”，而非“寻找美感”。对于平庸但无硬伤的作品，综合评分基准定在 60-65 分。
        2. 对于落入俗套的情节、说教式的口吻、成人主义的傲慢，对应维度的分数必须直接削减 50%。
        3. 原创性是核心门槛。若概念陈旧，即使文笔优美，总分也绝对不得超过 70 分。
        4. 综合学术评分中，85分以上代表“具备传世潜力”，绝不轻易给出。

        【强制输出规范】
        请直接输出你的最终评审报告，严格使用下方的排版格式。
        （👇 注意：下方只是一个格式范例，请将分数和评语替换为你对本文的【真实评估结果】！）

        ### 📊 综合学术评分：85/100

        ### 💡 逻辑与原创性审查
        * **事实与逻辑排查**：逻辑严密，无明显硬伤。（或者指出具体漏洞）
        * **原创性评估**：8/10分。设定新颖，视角独特。

        ### 🧮 维度解析与单项得分
        （注意：这四项的实际得分相加，必须等于上方的综合评分！）
        {example_dims}
        
        ### 📝 核心修改建议
        1. 建议在结尾处增加...
        2. 建议削弱某些冗余的对话...
        """

        # 3. 运行自适应调权
        adaptive_inst = await cls._get_adaptive_instruction(raw_text, base_weights, user_note)
        
        # 4. 合并所有指令：特定体系指令 + 自适应分配权重 + 严格防呆格式
        combined_instruction = model_system_instruction + "\n\n" + adaptive_inst + "\n\n" + eval_sys_inst
        
        try:
            eval_model = genai.GenerativeModel(
                model_name=target_model, # 使用鉴权层传来的模型 (如 3.1-pro)
                system_instruction=combined_instruction
            )
            
            prompt = f"【需要评审的作品内容】：\n{raw_text}\n\n【评委备注】：{user_note if user_note else '无'}\n\n请严格照着 System Instruction 中的范例格式，给我真实的打分数字！"
            
            # 保留 V1 中评价任务最稳健的 temperature
            res = await eval_model.generate_content_async(
                prompt, 
                generation_config=genai.types.GenerationConfig(temperature=0.4)
            )
            
            if res.candidates and res.candidates[0].content.parts:
                return res.text
            else:
                raise ValueError("模型未返回有效文本，可能触发了安全拦截。")
                
        except Exception as e:
            print(f"🚨 评审引擎调用异常: {e}")
            raise HTTPException(status_code=500, detail=str(e))
