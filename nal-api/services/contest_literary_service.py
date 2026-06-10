# services/contest_literary_service.py
import json
from core.config import settings
# 🚨 1. 切换到 Google 官方全新一代 GenAI 核心库
from google import genai
from google.genai import types

# 🚨 2. 初始化标准客户端（它会自动、优先读取系统环境变量中的 GEMINI_API_KEY）
client = genai.Client()

class ContestLiteraryService:
    @staticmethod
    async def evaluate_contest_work(text: str, pil_images: list, persona: str = "panoramic"):
        """
        多模态会诊：同时吃进文本和真实的插画 PIL 对象。
        基于新版 SDK 架构，完美支持 Gemini 2.5 Pro 的推理思维链空间，100% 免疫截断。
        """
        # 专家系统指令矩阵
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

        # 🚨 3. 采用新版标准的 GenerateContentConfig 模式
        # 新版 SDK 在未指定 max_output_tokens 时，会自动动态扩展以容纳模型的 Reasoning (内部思考) 消耗
        config = types.GenerateContentConfig(
            temperature=0.3,
            top_p=0.95,
            top_k=40,
            system_instruction=system_instruction,
            response_mime_type="application/json",
        )
        
        try:
            # 4. 构造多模态混编矩阵
            contents = [text] + pil_images
            
            # 🚨 5. 调用新版异步流式 API 核心：client.aio.models.generate_content
            response = await client.aio.models.generate_content(
                model="gemini-2.5-pro", 
                contents=contents,
                config=config
            )
            
            # 6. 安全验证返回体
            if not response.text:
                raise ValueError("Gemini 核心未返回任何有效文本，可能触发了底层内容安全机制")
                
            # 7. 解析结果
            result_json = json.loads(response.text)
            
            # 8. 触发联动拦截
            if result_json.get("scores", {}).get("感官对位") == 0 and "违规" in result_json.get("review", ""):
                raise ValueError(f"图片审核未通过: {result_json['review']}")
                
            return result_json
            
        except json.JSONDecodeError as je:
            print(f"❌ 专家 {persona} 返回数据解析失败。原始文本: {response.text if 'response' in locals() else '无'}")
            return {
                "scores": {"文学底色": 0, "叙事创新": 0, "时代感": 0, "感官对位": 0}, 
                "review": f"返回的 JSON 结构受损: {str(je)}"
            }
        except Exception as e:
            print(f"❌ 专家 {persona} 评审或安全拦截触发: {e}")
            if "图片审核未通过" in str(e):
                raise e
            return {
                "scores": {"文学底色": 0, "叙事创新": 0, "时代感": 0, "感官对位": 0}, 
                "review": f"评审环节出现异常: {str(e)}"
            }
