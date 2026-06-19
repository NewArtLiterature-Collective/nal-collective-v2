# services/contest_literary_service.py
import json
from core.config import settings
from google import genai
from google.genai import types

client = genai.Client()

AI_KEYWORDS = [
    'stable diffusion', 'midjourney', 'dall-e', 'dall·e',
    'comfyui', 'automatic1111', 'novelai', 'parameters',
    'cfg scale', 'sampler', 'steps:', 'lora', 'controlnet',
    'dreamshaper', 'invokeai', 'leonardo.ai', 'sdxl', 'swinir'
]

class ContestLiteraryService:
    
    @staticmethod
    def _extract_ai_fingerprint_from_pil(img) -> str:
        """在大闸入库前，深度扫描 PIL 对象的深层元数据与生成参数"""
        meta_text = ""
        try:
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
                    return kw
        except Exception:
            pass
        return ""

    @staticmethod
    async def evaluate_contest_work(text: str, pil_images: list, persona: str = "panoramic", has_declared_ai: bool = False):
        """
        多模态会诊：融入前端 AI 声明与底层 Metadata 强力审查。
        """
        # 🚨 1. 提取图片的硬性底层证据
        found_fingerprints = set()
        for img in pil_images:
            fp = ContestLiteraryService._extract_ai_fingerprint_from_pil(img)
            if fp:
                found_fingerprints.add(fp)
                
        evidence_msg = ""
        if found_fingerprints:
            tools = ", ".join(found_fingerprints)
            if not has_declared_ai:
                evidence_msg = f"🚨【系统硬性铁证】：作者在前端声明了“未使用AI”。但底层代码从图片的 Metadata(元数据) 中提取到了明确的 AI 生成工具特征或参数 ({tools})。这构成了严重的欺瞒行为！请在 review 中严肃通报，强制给予极低的综合打分，并将 ai_probability 设定为 99！"
            else:
                evidence_msg = f"【系统提示】：作者已声明使用 AI 辅助，并且元数据也验证了含有 ({tools}) 痕迹。请重点关注其作为艺术作品的情感内核与人工二次编排的诚意。"
        else:
            if not has_declared_ai:
                evidence_msg = "【系统提示】：作者声明未使用 AI，且底层元数据未发现已知 AI 标记。请凭极高的专家直觉审视其文本和画面是否存在机器套路感。"
            else:
                evidence_msg = "【系统提示】：作者主动声明使用了 AI 辅助。请客观评估其整体品质与人工介入的巧思。"

        prompts = {
            "panoramic": (
                "你是资深编辑，关注结构与图文绝对对位。你现在能同时看到故事文本和配套插画。\n"
                f"{evidence_msg}\n"
                "🚨【刚性红线】：如果插画中包含违规内容，请在 review 中写明‘图片违规隐患’并全维度打 0 分！\n"
                "🚨【绝对指令】：打分必须采用严格的百分制（0-100的整数）！\n"
                "🚨【AI 痕迹侦测】：结合上述系统提示与你的直觉，综合给出一个 0-100 的 ai_probability（AI生成概率）。\n"
                "若合规，请评估画面视觉张力与文本互文结构，给出四个维度的打分和80字以内总结。"
            ),
            "nal_chief": (
                "你是首席专家，严厉打击“人造儿童”。你现在能同时看到故事文本和配套插画。\n"
                f"{evidence_msg}\n"
                "🚨【刚性红线】：若发现敏感违规视觉，判定‘视觉违规’并全维度打 0 分！\n"
                "🚨【绝对指令】：打分必须采用严格的百分制（0-100的整数）！\n"
                "🚨【AI 痕迹侦测】：请审视文本的“说教机器味”与画面的“AI图库塑料感”，结合系统证据，给出一个 0-100 的 ai_probability。\n"
                "重点寻找插画与文字配合时的先锋性和实验性。评语要犀利，若有艺术灵性请破格给高分。"
            ),
            "li_lifang": (
                "你是学术专家，基于李利芳儿童精神理论。你现在能同时看到故事文本和配套插画。\n"
                f"{evidence_msg}\n"
                "🚨【刚性红线】：若插画违规，直接拒绝评审，全维度归 0。\n"
                "🚨【绝对指令】：打分必须采用严格的百分制（0-100的整数）！\n"
                "🚨【AI 痕迹侦测】：考察作品是否缺乏真正人类的“生命本体深度”，结合系统铁证，给出综合 ai_probability (0-100)。\n"
                "考察图文结合后展现出的儿童本体深度。评语要深邃。"
            )
        }

        system_instruction = prompts.get(persona, prompts["panoramic"])
        system_instruction += "\n\n请务必只返回标准的 JSON 格式：{\"scores\": {\"文学底色\": 0, \"叙事创新\": 0, \"时代感\": 0, \"感官对位\": 0}, \"review\": \"...\", \"ai_probability\": 0}"

        config = types.GenerateContentConfig(
            temperature=0.3,
            top_p=0.95,
            top_k=40,
            system_instruction=system_instruction,
            response_mime_type="application/json",
        )
        
        try:
            contents = [text] + pil_images
            response = await client.aio.models.generate_content(model="gemini-2.5-pro", contents=contents, config=config)
            
            if not response.text:
                raise ValueError("Gemini 核心未返回任何有效文本，可能触发了底层内容安全机制")
                
            result_json = json.loads(response.text)
            
            if result_json.get("scores", {}).get("感官对位") == 0 and "违规" in result_json.get("review", ""):
                raise ValueError(f"图片审核未通过: {result_json['review']}")
                
            return result_json
            
        except json.JSONDecodeError as je:
            return {
                "scores": {"文学底色": 0, "叙事创新": 0, "时代感": 0, "感官对位": 0}, 
                "review": f"返回的 JSON 结构受损: {str(je)}",
                "ai_probability": 0
            }
        except Exception as e:
            if "图片审核未通过" in str(e):
                raise e
            return {
                "scores": {"文学底色": 0, "叙事创新": 0, "时代感": 0, "感官对位": 0}, 
                "review": f"评审环节出现异常: {str(e)}",
                "ai_probability": 0
            }
