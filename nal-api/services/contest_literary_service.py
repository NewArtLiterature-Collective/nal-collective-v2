# services/contest_literary_service.py
import json
from core.config import settings
import google.generativeai as genai

class ContestLiteraryService:
    @staticmethod
    async def evaluate_contest_work(text: str, pil_images: list, persona: str = "panoramic"):
        """
        多模态会诊：同时吃进文本和真实的插画 PIL 对象。
        在系统指令里直接嵌入内容合规红线与真实的图文互文对位评估。
        """
        # 1. 在每个专家的指令里，刚性注入图片内容安全红线
        prompts = {
            "panoramic": (
                "你是资深编辑，关注结构与图文绝对对位。你现在能同时看到故事文本和配套插画。\n"
                "🚨【刚性红线】：如果插画中包含不适合儿童阅读的血腥、暴力、色情或严重违规内容，请立刻在 JSON 的 review 中写明‘图片违规隐患’，并将所有维度分直接打 0 分！\n"
                "若合规，请精准评估画面视觉张力与文本的互文结构，给出文学底色、叙事创新、时代感、感官对位四个维度的打分（0-100，表现优异请慷慨给予85分以上）和80字以内总结。"
            ),
            "nal_chief": (
                "你是首席专家，严厉打击“人造儿童”。你现在能同时看到故事文本和配套插画。\n"
                "🚨【刚性红线】：若发现插画带有不合规的敏感有害视觉，直接在 review 中判定‘视觉违规’并全维度打 0 分！\n"
                "重点寻找插画与文字配合时展现出的先锋性和实验性。评语要犀利，切中要害，若有艺术灵性请破格给高分。"
            ),
            "li_lifang": (
                "你是学术专家，基于李利芳儿童精神理论。你现在能同时看到故事文本和配套插画。\n"
                "🚨【刚性红线】：若插画包含儿童不宜的违规擦边内容，直接拒绝评审，全维度归 0。\n"
                "考察图文结合后展现出的儿童本体深度，审慎评估画面是否真正进入了儿童的本位世界。评语要深邃。"
            )
        }

        system_instruction = prompts.get(persona, prompts["panoramic"])
        system_instruction += "\n\n请务必只返回标准的 JSON 格式：{\"scores\": {\"文学底色\": 0, \"叙事创新\": 0, \"时代感\": 0, \"感官对位\": 0}, \"review\": \"...\"}"

        generation_config = {
            "temperature": 0.3,  # 👈 完美咬合你刚才接受的 0.3 放宽调整
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens":8192,
            "response_mime_type": "application/json",
        }

        model = genai.GenerativeModel(
            model_name="models/gemini-2.5-pro", 
            system_instruction=system_instruction,
            generation_config=generation_config
        )
        
        try:
            # 🚨 核心修改：构造多模态输入矩阵。将文字和所有的 PIL 图片对象混编进一个列表发给 Gemini
            contents = [text] + pil_images
            
            # 4. 异步生成内容（大模型此时既读了文字，又睁眼看了所有的画）
            response = await model.generate_content_async(contents)
            
            # 5. 解析结果
            result_json = json.loads(response.text)
            
            # 🚨 触发联动拦截：如果任意一个专家在看画后给出了 0 分或判定违规，直接抛出异常让流水线将其标记为 invalid
            if result_json["scores"]["感官对位"] == 0 and "违规" in result_json["review"]:
                raise ValueError(f"图片审核未通过: {result_json['review']}")
                
            return result_json
            
        except Exception as e:
            print(f"❌ 专家 {persona} 评审或安全拦截触发: {e}")
            # 如果是主动发现的图片违规，向上抛出，让外层的 pipeline 把作品直接刷成 "invalid" 状态
            if "图片审核未通过" in str(e):
                raise e
            return {
                "scores": {"文学底色": 0, "叙事创新": 0, "时代感": 0, "感官对位": 0}, 
                "review": f"评审环节出现异常: {str(e)}"
            }
