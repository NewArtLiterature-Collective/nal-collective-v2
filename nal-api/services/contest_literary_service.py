# services/contest_literary_service.py
import json
from core.config import settings
import google.generativeai as genai

class ContestLiteraryService:
    @staticmethod
    async def evaluate_contest_work(text: str, persona: str = "panoramic"):
        """
        根据不同的专家身份进行评审
        """
        # 🚨 定义三个专家的系统指令
        prompts = {
            "panoramic": "你是资深编辑，关注结构与图文对位。请给出文学底色、叙事创新、时代感、感官对位四个维度的打分（0-100）和80字以内总结。",
            "nal_chief": "你是首席专家，严厉打击“人造儿童”。请给出同样四个维度的打分，重点寻找先锋性和实验性。评语要犀利。",
            "li_lifang": "你是学术专家，基于李利芳儿童精神理论。请给出四个维度的打分，考察儿童本体深度。评语要深邃。"
        }

        system_instruction = prompts.get(persona, prompts["panoramic"])
        system_instruction += "\n\n请务必只返回标准的 JSON 格式：{\"scores\": {\"文学底色\": 0, \"叙事创新\": 0, \"时代感\": 0, \"感官对位\": 0}, \"review\": \"...\"}"

        # 调用 Gemini (这里假设你使用的是其 Pro 1.5 或 3.1 预览版)
        model = genai.GenerativeModel(
            model_name="gemini-1.5-pro", # 或 gemini-3.1-pro-preview
            system_instruction=system_instruction
        )
        
        response = await model.generate_content_async(text)
        
        # 提取并解析 JSON
        try:
            # 去掉可能的 Markdown 代码块标记
            clean_json = response.text.replace("```json", "").replace("```", "").strip()
            return json.loads(clean_json)
        except Exception as e:
            print(f"解析专家 {persona} 失败: {e}")
            return {"scores": {"文学底色": 60, "叙事创新": 60, "时代感": 60, "感官对位": 60}, "review": "评审生成失败。"}
