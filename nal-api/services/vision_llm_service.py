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
        """
        🚀 获取 NAL 升级版创作指导型视觉评审指令
        已植入：反“视觉人造儿童”警示、4:3:3 子维度强制拆解
        """
        
        core_philosophy = """
        【编辑哲学前提：全龄化与生命本位】
        优秀的视觉叙事必须同时为儿童与成人创造真实的阅读体验。
        
        【🚨 视觉评审极度警示（必须规避的三大陷阱）】
        1. 警惕「精美陷阱」：视觉极为精美但沦为“画廊展品”。若图画未参与叙事或缺乏文本推进力，必须严厉扣分。
        2. 警惕「视觉人造儿童」：严查画面中是否有将儿童强行宠物化、弱智化的视觉表达。坚决抵制披着低幼外衣的刻板道德说教。
        3. 警惕「图文复读机」：画出来的和写出来的一模一样，毫无文本与图像的博弈和互补空间。
        """
        
        # 维度 1：画面艺术性
        artistry_base = """
        1. 视觉艺术性与工业水准 (满分 4.0)：
           - 评估作品的原创辨识度、色彩/线条/造型的自洽性，是否具有不妥协的艺术尊严？
           - 警惕“朴素偏见”：风格简单不等于缺乏艺术性，重点在于表达的准确性。
        """
        
        # 维度 2：创意与隐喻
        creativity_advance = """
        2. 图像主体意识与全龄隐喻 (满分 3.0)：
           - 图像是否运用了儿童视平线，赋予儿童真正的“主体意识”，而非被成人凝视的客体？
           - 画面中是否预埋了超越表层叙事的视觉隐喻，引发全龄读者的深层共鸣？
        """
        
        # 维度 3：叙事引擎 (双轨制分流)
        if image_type == "illustration":
            narrative_advance = """
        3. 单幅叙事张力 (满分 3.0) - 【🎨 插画专属标准】：
           - 重点考核其是否能在单张画面内完成情绪爆发，具备“定格动画”般的瞬间表现力和巨大的空间张力。绝不用“翻页连贯性”苛求单幅插画。
            """
        else: # 默认为 picturebook
            narrative_advance = """
        3. 图文对位与「第三层故事」 (满分 3.0) - 【📖 绘本专属标准】：
           - 研判图文关系层次（同步/互补/对位/对抗）。
           - 图像是否填补了文字的留白？图文合并后，是否产生了超越各自的“第三层故事”？翻页的物理节奏是否被巧妙设计？
            """

        cot_steps = """
        【强制执行步骤（防止幻觉与打分波动）】
        你必须按照提供的 JSON 格式输出。
        1. 首先，分别评估三个子维度的得分（score_artistry, score_subject, score_narrative）。
        2. 然后，将三者严格相加，得出 v65_visual_score。
        3. 在 v65_synergy_report 中，明确回答该作品是否触发了上述“三大陷阱”。
        """
        
        work_name = "插画作品" if image_type == "illustration" else "绘本作品"
        
        return f"""你现在是 NAL 顶尖儿童文学视觉评审专家与艺术指导顾问。请严格根据以下标准评审这组【{work_name}】，重点在于提出具体的打磨改进建议，并必须仅以 JSON 格式输出结果。

        {core_philosophy}

        【核心评分维度（4:3:3）】：
        {artistry_base}
        {creativity_advance}
        {narrative_advance}

        {cot_steps}
        
        【强制 JSON 输出格式】
        必须严格输出以下 JSON，不要包含 Markdown 标记：
        {{
            "score_artistry": 浮点数 (0.0-4.0),
            "score_subject": 浮点数 (0.0-3.0),
            "score_narrative": 浮点数 (0.0-3.0),
            "v65_visual_score": 浮点数 (1-10分，前三项的严格加总),
            "v65_critique": "集成理论的综合艺术点评，必须针对画面缺陷提出可执行的修改建议",
            "v65_prediction": "限制三个固定值之一：'提出修改建议'、'认定是视觉杰作'、'需人工复核'",
            "v65_synergy_report": "包含陷阱自查与画面优缺点理论映射的思维链分析"
        }}
        """

    @classmethod
    async def evaluate_visual_work(
        cls, 
        target_model: str, 
        image_type: str, 
        image_urls: list, 
        work_text: str = "", 
        page_texts: list = None,  # 🚨 找回丢失的参数！
        is_pro: bool = False      # 🚨 找回丢失的参数！
    ) -> str:
        """
        🖼️ 核心多模态评估入口（动态上限 + 等距抽样 + 图文强绑定）
        """
        # 1. 动态设定算力上限
        MAX_IMAGES = 50 if is_pro else 12

        # 2. 智能等距抽样算法 (Uniform Spaced Sampling)
        total_images = len(image_urls)
        if total_images > MAX_IMAGES:
            print(f"⚠️ 图片数量({total_images})超出上限({MAX_IMAGES})，触发等距抽样算法。")
            step = total_images / MAX_IMAGES
            # 均匀抽取中间页
            sampled_indices = [int(i * step) for i in range(MAX_IMAGES)]
            # 刚性覆盖：确保绘本的“大结局”（最后一页）绝对被包含在内
            if sampled_indices[-1] != total_images - 1:
                sampled_indices[-1] = total_images - 1
        else:
            sampled_indices = list(range(total_images))

        # 3. 执行下载与图文强绑定 (Index Binding)
        processed_pairs = []
        for i in sampled_indices:
            url = image_urls[i]
            img = cls._fetch_and_process_image(url)
            if img:
                # 🚨 核心关系处理：严格对齐文本。如果缺失文本数组，用兜底文本填补，绝不错位！
                if page_texts is not None:
                    pt_text = page_texts[i] if i < len(page_texts) and page_texts[i].strip() else "（本页无文字描述/纯无字分镜）"
                else:
                    pt_text = ""

                processed_pairs.append({
                    "original_page": i + 1,  # 记录这幅图在原书中的真实物理页码
                    "image": img,
                    "text": pt_text
                })

        if not processed_pairs:
            raise ValueError("未提取到有效的图片用于视觉评审。")

        # 4. 构建 Prompt 和内容交织列表 (Interleaving)
        system_instruction = cls._get_v65_instruction(image_type)
        contents = []

        # 🚨 商业路由：如果是绘本且传入了分页文本（代表触发了高阶文图协作）
        if page_texts is not None and image_type == "picturebook":
            contents.append(f"【高阶评审模式：逐页图文对位审查】以下为系统从原书中提取的 {len(processed_pairs)} 个跨页/分镜剧本：\n")
            
            # 将图文像三明治一样交织组装
            for pair in processed_pairs:
                contents.append(f"--- 📖 原书第 {pair['original_page']} 跨页/分镜 ---")
                contents.append(f"📄 本页文本/剧本: {pair['text']}")
                contents.append(pair['image'])
                
            contents.append("\n【终审指令】：请严格根据上方逐页映射的图文关系，评估图画是否填补了文字的留白？是否存在高级的反讽、对位或互补关系？警惕图文完全重复的“复读机”现象。")
            
        else:
            # 基础降级模式：全局文本 + 图片瀑布流
            contents.append(f"【作品全局补充文本】: {work_text}")
            for pair in processed_pairs:
                contents.append(pair['image'])

        # 5. 调用模型
        try:
            model = genai.GenerativeModel(
                model_name=target_model,
                system_instruction=system_instruction
            )
            
            res = await model.generate_content_async(
                contents,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.2, # 恢复艺术感知的黄金温度
                    response_mime_type="application/json"
                )
            )
            
            if res.candidates and res.candidates[0].content.parts:
                result_json = json.loads(res.text)
                
                # 自动解包防御
                if isinstance(result_json, list):
                    print("⚠️ 接收到 list 格式响应，正在执行自动解包...")
                    if len(result_json) > 0 and isinstance(result_json[0], dict):
                        result_json = result_json[0]
                    else:
                        raise ValueError("视觉模型返回了非法的空列表或格式错误。")
                
                # 渲染最终 Markdown 报告
                artistry = result_json.get('score_artistry', 'N/A')
                subject = result_json.get('score_subject', 'N/A')
                narrative = result_json.get('score_narrative', 'N/A')

                markdown_report = f"""
### 🎨 NAL 视觉艺术评审与指导报告

**📊 综合视觉表现分：{result_json.get('v65_visual_score', 'N/A')} / 10**
*(单项得分明细：艺术质感 {artistry}/4.0 | 主体意识 {subject}/3.0 | 叙事对位 {narrative}/3.0)*

**🔍 评审指导结论：{result_json.get('v65_prediction', 'N/A')}**

---

#### 💡 综合评审与修改建议
{result_json.get('v65_critique', 'N/A')}

#### 🔬 理论映射与专项诊断 (陷阱自查与思维链)
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
