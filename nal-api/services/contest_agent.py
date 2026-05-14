async def gatekeeper_agent(submission_id: str, text: str, images: list):
    """
    Agent A: 物理校验。
    标准：文字 >= 800，插画 >= 1。
    """
    word_count = len(text)
    image_count = len(images)
    
    if word_count < 800 or image_count < 1:
        await update_db(submission_id, {
            "status": "invalid",
            "error_msg": f"字数({word_count})或插画({image_count})未达标"
        })
        return False
    
    await update_db(submission_id, {"status": "evaluating", "word_count": word_count})
    return True
