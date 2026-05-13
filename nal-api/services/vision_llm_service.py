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
        """获取 NAL V6.5 双轨制视觉评审指令"""
        
        # 维度 1：画面艺术性
        artistry_base = """
        1. 画面艺术性 (权重 40%)：
           - 基于【陈晖：视觉呈现】：评估线条生命力、色彩契合度、造型独创性及全书风格稳定性。
           - 基于【葛承训：文化活化】：识别并评价画面中民族元素的现代转化水平。
        """
        
        # 维度 2：创意与隐喻
        creativity_advance = """
        2. 创意与隐喻 (权重 30%)：
           - 基于【视觉隐喻】：评估画面意象的厚度如何？是否具备多层解码空间？符号创新是否具有独特性？
        """
        
        # 维度 3：叙事引擎 (核心双轨制分流)
        if image_type == "illustration":
            narrative_advance = """
        3. 单幅叙事张力 (权重 30%) - 【⚠️ 插画专属标准】：
           - 绝不要用绘本的“翻页连贯性”来苛求插画！
           - 考核其是否能在单张（或几张不连贯的）画面内完成完整的情绪叙事或故事浓缩。
           - 画面是否具备“定格动画”般的瞬间表现力和巨大的空间张力。
            """
        else: # 默认为 picture-book
            narrative_advance = """
        3. 叙事与节奏 (权重 30%) - 【📖 绘本专属标准】：
           - 基于【巴德：总合设计】：评估图文依存关系及视觉节奏驱动力。
           - 基于【叙事效率】：画面是否提供了文字以外的代偿性细节？
           - 基于【翻页节奏】：全书视觉流向是否具备张力？翻页是否有呼吸感？
            """

        cot_steps = """
        【强制执行步骤（防止幻觉与分数波动）】
        在你给出最终的 v65_visual_score 之前，必须在 v65_synergy_report 中严格按以下步骤书写你的思考过程：
        - [步骤一 视觉锚定]：客观列出你在画面中看到的 3 个最核心的视觉细节（如特定色彩、服饰符号或人物动作）。
        - [步骤二 理论映射]：将上述细节分别带入 4:3:3 的三个维度中进行评判。
        - [步骤三 量化算式]：写出你对三个维度的子评分（如：艺术3.8 + 创意2.5 + 叙事2.6），加总后再给出最终总分。
        """
        
        award_name = "插画奖" if image_type == "illustration" else "绘本奖"
        
        return f"""你现在是 NAL 终审主席。请严格根据以下 4:3:3 的权重标准评审这组【{award_name}】作品，并必须仅以 JSON 格式输出结果。

        【核心评分维度】：
        {artistry_base}
        {creativity_advance}
        {narrative_advance}

        {cot_steps}
        
        【强制 JSON 输出格式】
        必须严格输出以下 JSON，不要包含 Markdown 标记：
        {{
            "v65_visual_score": 浮点数 (1-10分),
            "v65_critique": "集成陈晖、巴德理论及进阶叙事视角的综合艺术点评",
            "v65_prediction": "最终评审结论，如：建议入围、视觉杰作、需专家复核",
            "v65_synergy_report": "包含步骤一、二、三的强制思维链专项分析"
        }}
        """

    @classmethod
    async def evaluate_visual_work(cls, target_model: str, image_type: str, image_urls: list, work_text: str = "") -> str:
        """
        🖼️ 核心多模态评估入口
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
            # 视觉任务建议使用 2.5-pro，如果外壳降级了，这里会跟随外壳的 target_model
            model = genai.GenerativeModel(
                model_name=target_model,
                system_instruction=system_instruction
            )
            
            res = model.generate_content(
                contents,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.1, # 极低温度，保证数学算式和打分的严谨性
                    response_mime_type="application/json"
                )
            )
            
            if res.candidates and res.candidates[0].content.parts:
                # 解析返回的 JSON 字符串
                result_json = json.loads(res.text)
                
                # 为了前端展示兼容，我们将其转换成一段漂亮的 Markdown 报告返回
                markdown_report = f"""
### 🎨 NAL 视觉艺术终审报告 (V6.5)

**📊 综合视觉表现分：{result_json.get('v65_visual_score', 'N/A')} / 10**
**🏆 评委会预测：{result_json.get('v65_prediction', 'N/A')}**

---

#### 💡 综合艺术点评
{result_json.get('v65_critique', 'N/A')}

#### 🔬 图文对撞与张力分析 (思维链)
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
