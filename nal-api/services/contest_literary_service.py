import json
from core.config import settings
import google.generativeai as genai

class ContestLiteraryService:
    @staticmethod
    async def evaluate_contest_work(text: str, persona: str = "panoramic"):
        """
        根据不同的专家身份进行评审，temperature 已设为 0.1 以确保严谨性。
        """
        # 1. 定义三个专家的系统指令
        prompts = {
            "panoramic": "你是资深编辑，关注结构与图文对位。请给出文学底色、叙事创新、时代感、感官对位四个维度的打分（0-100）和80字以内总结。",
            "nal_chief": "你是首席专家，严厉打击“人造儿童”。请给出同样四个维度的打分，重点寻找先锋性和实验性。评语要犀利。",
            "li_lifang": "你是学术专家，基于李利芳儿童精神理论。请给出四个维度的打分，考察儿童本体深度。评语要深邃。"
        }

        system_instruction = prompts.get(persona, prompts["panoramic"])
        system_instruction += "\n\n请务必只返回标准的 JSON 格式：{\"scores\": {\"文学底色\": 0, \"叙事创新\": 0, \"时代感\": 0, \"感官对位\": 0}, \"review\": \"...\"}"

        # 2. 配置生成参数
        generation_config = {
            "temperature": 0.1,  # 🚨 降低随机性，确保打分稳健
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 1024,
            "response_mime_type": "application/json", # 🔒 强制 JSON 输出模式
        }

        # 3. 初始化模型
        # 注意：建议使用 models/gemini-2.5-pro 或 models/gemini-3.1-flash-preview
        model = genai.GenerativeModel(
            model_name="models/gemini-2.5-pro", 
            system_instruction=system_instruction,
            generation_config=generation_config
        )
        
        try:
            # 4. 异步生成内容
            response = await model.generate_content_async(text)
            
            # 5. 解析结果
            # 由于开启了 response_mime_type，返回的内容直接就是标准的 JSON 字符串
            return json.loads(response.text)
            
        except Exception as e:
            print(f"❌ 专家 {persona} 评审任务失败: {e}")
            # 返回兜底数据，避免流水线完全中断
            return {
                "scores": {"文学底色": 0, "叙事创新": 0, "时代感": 0, "感官对位": 0}, 
                "review": f"评审环节出现异常: {str(e)}"
            }
