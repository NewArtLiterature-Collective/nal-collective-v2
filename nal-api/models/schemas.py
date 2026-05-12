from pydantic import BaseModel, Field
from typing import Optional

class EvalRequest(BaseModel):
    work_title: str = Field(..., description="作品标题，用于归档")
    work_text: str = Field(..., description="要评审的作品全文")
    mentor_type: str = Field(..., description="选择的模型名称，必须严格匹配数据库的 name 字段")
    user_note: Optional[str] = Field("", description="用户提供的额外评审偏好或干预备注")
    is_pro: bool = Field(False, description="标识当前调用是否拥有 Pro 权限") # 👈 补上这个字段