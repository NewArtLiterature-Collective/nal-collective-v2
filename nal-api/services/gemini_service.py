import google.generativeai as genai
import json
import re
from core.config import settings

# 在服务启动时初始化 API 引擎
genai.configure(api_key=settings.GEMINI_API_KEY)

class GeminiService:
    # --- 算力双轨配置 ---
    MODEL_FLASH = "gemini-2.5-flash"
    MODEL_PRO = "gemini-3.1-pro-preview" # 若免费额度不够，测试时可临时改为 gemini-1.5-pro
    
    @classmethod
    def _extract_text_features(cls, text: str) -> dict:
        """
        [预读阶段] 使用 Flash 模型极速生成文本指纹
        """
        sense_prompt = """你是一个文本特征分析器。请严谨分析该儿童文学文本指标(0.0-1.0)：
        1.fantasy(幻想感) 2.reality(现实/时代感) 3.character(人物心理深度)。
        必须仅输出纯 JSON 格式：{"fantasy": 0.5, "reality": 0.5, "character": 0.5}"""

        try:
            model = genai.GenerativeModel(cls.MODEL_FLASH)
            res = model.generate_content(
                f"{sense_prompt}\n内容：{text[:2000]}", 
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            return json.loads(res.text)
        except Exception as e:
            print(f"⚠️ 预读引擎异常，启用默认均衡指纹: {e}")
            return {"fantasy": 0.5, "reality": 0.5, "character": 0.5}

    @classmethod
    def _calculate_adaptive_instruction(cls, model_data: dict, current_text: str, user_note: str = "") -> str:
        """
        [校准阶段] 根据文本指纹与用户备注，动态干预并生成最终 System Instruction
        """
        base_params = model_data.get('parameters', {})
        if not base_params:
            return model_data.get('system_instruction', '')

        features = cls._extract_text_features(current_text)
        adjusted_weights = base_params.copy()
        sensitivity = 15
        
        # NAL 独家语义指纹感应矩阵
        mapping = {
            "fantasy": ["跨界", "共鸣", "幻想", "想象", "诗意", "隐喻", "对位", "意象", "视觉", "分镜", "艺术", "留白", "介入", "童话", "虚构"],
            "reality": ["时代", "社会", "技术", "异化", "现实", "真相", "背景", "偏见", "价值观", "伦理", "批判", "成人主义", "意识形态", "病灶"],
            "character": ["人物", "心理", "契合", "塑造", "成长", "主体", "非人类", "尊严", "共生", "视角", "动机", "弧光", "自我", "共情"]
        }

        # 根据指纹偏移调整权重
        for dim in adjusted_weights.keys():
            if any(k in dim for k in mapping["fantasy"]):
                adjusted_weights[dim] = max(1, adjusted_weights[dim] + (features.get('fantasy', 0.5) - 0.5) * sensitivity)
            if any(k in dim for k in mapping["reality"]):
                adjusted_weights[dim] = max(1, adjusted_weights[dim] + (features.get('reality', 0.5) - 0.5) * sensitivity)
            if any(k in dim for k in mapping["character"]):
                adjusted_weights[dim] = max(1, adjusted_weights[dim] + (features.get('character', 0.5) - 0.5) * sensitivity)

        # 人工干预暴力提权
        intervention_log = ""
        if user_note:
            for dim in adjusted_weights.keys():
                if dim[:2] in user_note:
                    adjusted_weights[dim] += 25
                    intervention_log += f"【已根据备注强化‘{dim}’】 "

        # 归一化百分比计算
        total = sum(adjusted_weights.values())
        final_weights = {k: round((v/total)*100, 1) for k, v in adjusted_weights.items()}
        weight_desc = "\n".join([f"- {k}: {v}%" for k, v in final_weights.items()])
        
        return f"""{model_data['system_instruction']}

---
【NAL 通用自适应校准报告】
文本指纹：幻想({features.get('fantasy')})，现实({features.get('reality')})，人物({features.get('character')})
{intervention_log}
动态权重矩阵：
{weight_desc}
---
请按此分配执行评审。"""

    @classmethod
    def execute_evaluation(cls, model_data: dict, mentor_type: str, work_text: str, user_note: str, is_pro_user: bool) -> dict:
        """
        [执行阶段] 生成终态 Prompt，调度对应算力引擎输出报告
        确保与 app.py 的严格一致性
        """
        base_weights = model_data.get('parameters', {})
        
        # 1. 获取自适应指令
        adaptive_inst = cls._calculate_adaptive_instruction(model_data, work_text, user_note)
        
        # 2. 100% 还原 app.py 中的高分示范模板拼装
        example_dims = ""
        for k, v in base_weights.items():
            example_score = int(v * 0.8) # 模拟 80% 的得分示范
            example_dims += f"* **{k}**：{example_score}/{v}分 - 这里的描写非常生动，完美契合了该维度的要求...\n"

        # 3. 100% 还原 app.py 中的评审核心 Prompt
        eval_sys_inst = f"""你现在是 NAL 数字化平台的顶级学术评审专家。你的评审风格以【犀利、冷峻、见血】著称。
        当前执行的评审体系：【{mentor_type}】
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

        combined_sys_inst = adaptive_inst + "\n\n" + eval_sys_inst

        # 4. 商业双轨制：严格按权限调度算力
        engine = cls.MODEL_PRO if is_pro_user else cls.MODEL_FLASH
        
        eval_model = genai.GenerativeModel(
            model_name=engine, 
            system_instruction=combined_sys_inst
        )
        
        # 5. 100% 还原 app.py 中的用户输入提示词
        prompt = f"【需要评审的作品内容】：\n{work_text}\n\n【评委备注】：{user_note if user_note else '无'}\n\n请严格照着 System Instruction 中的范例格式，给我真实的打分数字！"
        
        try:
            res = eval_model.generate_content(
                prompt, 
                generation_config=genai.types.GenerationConfig(temperature=0.4)
            )
            
            # 正则提取总分，兼容多种变体写法
            score_val = 0
            clean_txt = res.text.replace('*', '').replace(' ', '')
            m_score = re.search(r"(?:综合学术评分|综合评分|总分)[】\]]?[:：]?\[?(\d{1,3})\]?(?:/100|分)?", clean_txt)
            if m_score: 
                score_val = int(m_score.group(1))

            return {
                "report": res.text,
                "score": score_val,
                "engine_used": engine
            }
        except Exception as e:
            raise Exception(f"AI 引擎推理失败: {str(e)}")