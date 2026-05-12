from core.database import supabase_db

class EvalService:
    @staticmethod
    def get_model_config(model_name: str) -> dict:
        """
        根据 name 字段，精确查询 evaluation_models 表获取学术体系配置
        """
        try:
            response = supabase_db.table("evaluation_models") \
                .select("system_instruction, parameters, description") \
                .eq("name", model_name) \
                .single() \
                .execute()
            
            if not response.data:
                raise ValueError(f"系统未在数据库中找到名为 '{model_name}' 的理论模型。")
                
            return response.data
        except Exception as e:
            raise Exception(f"获取模型配置异常: {str(e)}")