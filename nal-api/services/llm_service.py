import os
import google.generativeai as genai
import asyncio
from dotenv import load_dotenv  # 🚨 新增：引入 dotenv 工具

# 🚨 新增：强制读取项目根目录下的 .env 文件
load_dotenv() 

# --- 1. 配置 Gemini API 密钥 ---
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)
    print("✅ 成功加载 GEMINI_API_KEY！") # 加个绿灯提示，看着放心
else:
    print("⚠️ 警告：未检测到 GEMINI_API_KEY 环境变量！请检查 .env 文件。")

# ... 下面的生成函数代码保持不变 ...

# --- 2. 核心生成函数 ---
async def generate_ai_report(model: str, system_prompt: str, user_text: str, image_urls: list = None):
    """
    负责与 Google Gemini 通信并生成评审/创作报告
    """
    try:
        # 1. 实例化模型并注入专家级 System Prompt
        gen_model = genai.GenerativeModel(
            model_name=model,
            system_instruction=system_prompt
        )

        # 2. 组装发给大模型的具体内容 (Prompt Parts)
        prompt_parts = []
        
        # 处理图片 URL (如果是插画评审)
        # 注意：这里我们简单将图床 URL 喂给大模型。如果使用的是原生 Gemini Vision，
        # 它能够直接读取部分公开 URL，或者你可以通过 prompt 引导它理解。
        if image_urls and len(image_urls) > 0:
            urls_str = "\n".join(image_urls)
            prompt_parts.append(f"【附带的视觉素材链接】(请综合分析以下画面)：\n{urls_str}")

        # 拼装用户输入的文本或提取出来的 Word 内容
        if user_text:
            prompt_parts.append(f"【用户文本/要求/备注】：\n{user_text}")

        final_prompt = "\n\n".join(prompt_parts)

        # 3. 发送请求 (使用 FastAPI 推荐的异步调用)
        # 释放 temperature 确保文学评审的锐度
        response = await gen_model.generate_content_async(
            final_prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.4, 
                max_output_tokens=8192
            )
        )

        # 4. 验证并返回内容
        if response.candidates and response.candidates[0].content.parts:
            return response.text
        else:
            # 捕获因安全策略被拦截的情况
            reason = response.candidates[0].finish_reason if response.candidates else "未知拦截"
            return f"⚠️ 引擎未能生成有效报告。原因代码：{reason}。请检查文本是否触发了安全过滤机制。"

    except Exception as e:
        print(f"❌ 大模型通信彻底失败: {e}")
        raise Exception(f"AI 引擎调用异常: {str(e)}")