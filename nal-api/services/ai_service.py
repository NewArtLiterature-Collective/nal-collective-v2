import google.generativeai as genai
from core.config import settings
from fastapi import HTTPException
import base64

# 配置 Gemini API
genai.configure(api_key=settings.GEMINI_API_KEY)

class AIService:
    @staticmethod
    def _get_model_and_prompt(user_status: str):
        """
        内部逻辑：根据用户权限分配模型名称和系统指令
        """
        if user_status == "free":
            # 普通用户：侧重基础纠错和简单反馈
            return "gemini-2.5-flash", """
            目前使用文学基础助教，对以下作品进行基础评审：
            1. 检查明显的错别字和语法错误。
            2. 评估故事逻辑是否通顺。
            3. 提供简单的鼓励性建议。
            保持语气亲切，字数在 300 字以内。
            """
        else:
            # 参赛选手/专业用户：深度专家评审（Pro 模型）
            return "gemini-2.5-pro", """
            目前使用资深的儿学评审专家和绘本插画评论家，
            对作品进行“全景深度评审”，包含以下维度：
            1. 文学艺术深度：探讨主题的独创性与情感共鸣。
            2. 儿童心理对标：分析作品是否符合目标年龄段的心理认知。
            3. 叙事节奏：评估文字的韵律感和翻页感。
            4. 插画审美（如有）：分析构图、色彩对叙事的增强作用。
            5. 出版潜力：给出专业的市场化修改建议。
            请输出一份极具深度且富有洞察力的专家报告。
            """

    @staticmethod
    async def evaluate_work(text: str, user_metadata: dict, image_data: str = None):
        """
        核心方法：执行评审逻辑
        image_data: Base64 编码的图片字符串
        """
        # 1. 识别身份
        is_paid = user_metadata.get("is_paid", False)
        user_status = "contestant" if is_paid else "free"
        
        model_name, system_instruction = AIService._get_model_and_prompt(user_status)
        
        try:
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_instruction
            )

            # 2. 构造内容列表
            contents = [f"作品文字内容如下：\n{text}"]

            # 3. 处理插画（仅限付费用户且有图片时）
            if image_data and is_paid:
                try:
                    # 转换 Base64 图片数据
                    img_bytes = base64.b64decode(image_data.split(",")[-1])
                    contents.append({
                        "mime_type": "image/jpeg",  # 建议前端统一转为 jpeg
                        "data": img_bytes
                    })
                    contents.append("请结合以上插画，分析画面与文字的互动关系。")
                except Exception as e:
                    print(f"图片处理失败: {e}")
                    # 图片失败不中断文字评审

            # 4. 调用 API
            response = await model.generate_content_async(contents)
            return response.text

        except Exception as e:
            print(f"AI 生成失败: {str(e)}")
            raise HTTPException(status_code=500, detail=f"AI 评审暂时不可用: {str(e)}")