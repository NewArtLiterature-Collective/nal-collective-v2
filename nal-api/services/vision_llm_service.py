# nal-api/services/vision_llm_service.py
import json
import io
import requests
import PIL.Image
from PIL import ImageFile
import google.generativeai as genai
from fastapi import HTTPException

# 允许加载截断图像，防止个别异常图片导致整个请求崩溃
ImageFile.LOAD_TRUNCATED_IMAGES = True
PIL.Image.MAX_IMAGE_PIXELS = None

class VisionLLMService:
    
    @staticmethod
    def _fetch_and_process_image(url: str, max_dim=1536) -> PIL.Image.Image:
        """从 URL 下载图片并进行降采样压缩，防止 API Payload 溢出"""
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            img = PIL.Image.open(io.BytesIO(response.content))
            
            # 缩放逻辑
            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim), PIL.Image.Resampling.LANCZOS)
            
            # 统一转为 RGB 并压缩
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=85)
            buf.seek(0)
            return PIL.Image.open(buf)
        except Exception as e:
            print(f"⚠️ 图片加载或处理失败 ({url}): {e}")
            return None

    @classmethod
    def _get_v65_instruction(cls, image_type: str) -> str:
        """获取 NAL V6.5 创作指导型视觉评审指令"""
        
        # 维度 1：画面艺术性
        artistry_base = """
        1. 画面艺术性 (权重 40%)：
           - 基于【陈晖：视觉呈现】：评估线条生命力、色彩契合度、造型独创性及风格稳定性。若有不足，明确指出破坏“真实心理深度”的视觉硬伤。
           - 基于【葛承训：文化活化】：识别画面中民族元素的现代转化水平，评价其是否流于传统符号的机械拼贴。
        """
        
        # 维度 2：创意与隐喻
        creativity_advance = """
        2. 创意与隐喻 (权重 30%)：
           - 基于【视觉隐喻】：评估画面意象的厚度。重点审视其是否为创作者主观捏造的“人工儿童”式空洞视觉，符号创新是否具备多层解码空间。
        """
        
        # 维度 3：叙事引擎 (双轨制分流)
        if image_type == "illustration":
            narrative_advance = """
        3. 单幅叙事张力 (权重 30%) - 【🎨 插画专属标准】：
           - 不要用绘本的“翻页连贯性”来苛求单幅插画！
           - 考核其是否能在单张（或不连贯的）画面内完成完整的情绪叙事、故事浓缩或定格张力。
            """
        else: # 默认为 picture-book
            narrative_advance = """
        3. 叙事与节奏 (权重 30%) - 【📖 绘本专属标准】：
           - 基于【巴德：总合设计】：评估图文依存关系、图文对撞效率（画面是否提供了文字以外的代偿细节）。
           - 基于【翻页节奏】：审视全书视觉流向的呼吸感与视觉张力驱动力。
            """

        cot_steps = """
        【强制执行步骤（防止幻觉与打分波动）】
        在你给出最终的 v65_visual_score 和结论之前，必须在 v65_synergy_report 中严格按以下步骤书写：
        - [步骤一 视觉锚定]：客观列出你在画面中看到的 3 个最核心的视觉细节（如颜色、特定符号、人物微表情）。
        - [步骤二 理论映射与诊断]：将这些细节带入 4:3:3 的三个维度中进行评判，重点指出哪里需要优化。
        - [步骤三 量化算式]：写出你对三个维度的子评分（如：艺术3.8 + 创意2.5 + 叙事2.6），加总得到最终总分。
        """
        
        work_name = "插画作品" if image_type == "illustration" else "绘本作品"
        
        return f"""你现在是 NAL 顶尖儿童文学视觉评审专家与艺术指导顾问。请严格根据以下 4:3:3 的权重标准评审这组【{work_name}】，重点在于提出具体的打磨改进建议，并必须仅以 JSON 格式输出结果。

        【核心评分维度】：
        {artistry_base}
        {creativity_advance}
        {narrative_advance}

        {cot_steps}
        
        【强制 JSON 输出格式】
        必须严格输出以下 JSON，不要包含 Markdown 标记：
        {{
            "v65_visual_score": 浮点数 (1-10分),
            "v65_critique": "集成陈晖、巴德理论的综合艺术点评，必须针对画面存在的缺陷提出清晰、可执行的修改建议（除非认定为杰作）",
            "v65_prediction": "限制三个固定值之一：'提出修改建议'、'认定是视觉杰作'、'需人工复核'",
            "v65_synergy_report": "包含步骤一、二、三的强制思维链专项诊断分析"
        }}
        """

    @classmethod
    async def evaluate_visual_work(cls, target_model: str, image_type: str, image_urls: list, work_text: str = "") -> str:
        """
        🖼️ 核心多模态评估入口（已对齐评审与指导业务）
        """
        # 1. 下载并处理图片
        processed_images = []
        for url in image_urls[:12]: # 限制最多 12 张防溢出
            img = cls._fetch_and_process_image(url)
            if img:
                processed_images.append(img)
                
        if not processed_images:
            raise ValueError("未提取到有效的图片用于视觉评审。")

        # 2. 构建 Prompt 和内容列表
        system_instruction = cls._get_v65_instruction(image_type)
        
        # 将文字和图片组合打包喂给大模型
        contents = [f"【作品补充文本（如有）】: {work_text}"]
        contents.extend(processed_images)

        # 3. 调用模型
        try:
            model = genai.GenerativeModel(
                model_name=target_model,
                system_instruction=system_instruction
            )
            
            res = await model.generate_content_async(
                contents,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.1, # 极低温度保证数学思维链的严谨
                    response_mime_type="application/json"
                )
            )
            
            if res.candidates and res.candidates[0].content.parts:
                # 解析返回的 JSON 字符串
                result_json = json.loads(res.text)
                if res.candidates and res.candidates[0].content.parts:
                # 解析返回的 JSON 字符串
                result_json = json.loads(res.text)
                
                # 🚨 核心防御：如果大模型因为多图原因调皮地返回了 [ {...} ] 数组格式，自动剥离外壳取第一个字典
                if isinstance(result_json, list):
                    print("⚠️ 接收到 list 格式响应，正在执行自动解包...")
                    if len(result_json) > 0 and isinstance(result_json[0], dict):
                        result_json = result_json[0]
                    else:
                        raise ValueError("视觉模型返回了非法的空列表或格式错误。")
                
                # 为了前端展示兼容，我们将其转换成一段漂亮的 Markdown 报告返回
                markdown_report = f"""
### 🎨 NAL 视觉艺术评审与指导报告 (V6.5)

**📊 综合视觉表现分：{result_json.get('v65_visual_score', 'N/A')} / 10**
**🔍 评审指导结论：{result_json.get('v65_prediction', 'N/A')}**

---

#### 💡 综合评审与修改建议
{result_json.get('v65_critique', 'N/A')}

#### 🔬 理论映射与专项诊断 (思维链)
{result_json.get('v65_synergy_report', 'N/A')}
"""
                return markdown_report
            else:
                raise ValueError("视觉模型未生成有效内容。")
                
        except json.JSONDecodeError:
            print(f"🚨 JSON 解析失败，原始返回：{res.text}")
            raise HTTPException(status_code=500, detail="模型未返回标准 JSON 格式。")
        except Exception as e:
            print(f"🚨 视觉引擎调用异常: {e}")
            raise HTTPException(status_code=500, detail=str(e))
