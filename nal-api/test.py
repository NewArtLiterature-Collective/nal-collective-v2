import asyncio
from models.schemas import EvalRequest
from services.eval_service import EvalService
from services.gemini_service import GeminiService

async def main():
    print("🚀 启动 NAL 双引擎架构本地测试...")

    # 1. 模拟前端传来的请求数据 (包含一段测试用的儿童文学文本)
    test_request = EvalRequest(
        work_title="寻星记（测试片段）",
        work_text="小时候，我总以为星星是天空不小心漏下的光。现在的我知道，那是遥远的恒星在无垠宇宙中孤独燃烧的残骸。但是，每当在钢筋水泥的城市里抬头，我依然会怀念那个在稻田边，试图用玻璃瓶装满星光的自己。",
        mentor_type="全景综合-通用基准模型", # ⚠️ 确保这个名字与你数据库里的 name 字段一字不差
        user_note="请重点关注现实与童年幻想的对比映射",
        is_pro=True # 测试解锁 Pro 算力
    )

    try:
        # 2. 测试第一关：Supabase 数据库连通性与配置拉取
        print(f"\n📥 [1/3] 正在从 Supabase 拉取模型库: {test_request.mentor_type}...")
        model_config = EvalService.get_model_config(test_request.mentor_type)
        print("✅ 数据库拉取成功！原始基准权重为：", model_config.get('parameters'))

        # 3. 测试第二关：预读引擎与动态自适应调权（这一步会在内部隐式执行）
        print("\n🧠 [2/3] 预读引擎正在提取文本指纹并进行动态调权...")

        # 4. 测试第三关：调用 Gemini 3.1 Pro 核心引擎输出报告
        print(f"⚙️ [3/3] 正在启动 Gemini 引擎 (当前算力: {'Pro 版' if test_request.is_pro else '基础版'})...")
        
        result = GeminiService.execute_evaluation(
            model_data=model_config,
            mentor_type=test_request.mentor_type,
            work_text=test_request.work_text,
            user_note=test_request.user_note,
            is_pro_user=test_request.is_pro
        )

        # 5. 打印最终结果
        print("\n🎉 引擎全链路运行成功！最终评审报告如下：")
        print("="*60)
        print(f"📊 提取到的总分: {result['score']}")
        print(f"🚀 实际使用引擎: {result['engine_used']}")
        print("="*60)
        print(result['report'])
        print("="*60)

    except Exception as e:
        print(f"\n❌ 测试链路中断，错误信息: {e}")

if __name__ == "__main__":
    asyncio.run(main())