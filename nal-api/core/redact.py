# nal-api/core/redact.py
# ============================================================================
# 密钥打码（2026-11）
# 起因：Stripe 密钥末尾带换行符时，底层网络库报"请求头不合法"，把整个请求头（Bearer sk_live_…）
#       原样写进错误信息；这条错误既进了 Render 日志，又作为错误提示返回给了浏览器。
# 对策（全局生效，不依赖各处代码自己小心）：
#   1. redact(text)：把文本里的密钥打码
#        · 按格式识别：sk_/rk_ live|test、whsec_、sb_secret_、Google API key（AIza…）、JWT（eyJ…，含 Supabase 密钥与用户令牌）
#        · 按数值识别：环境变量里名字含 KEY / SECRET / TOKEN / PASSWORD 的值，原样出现即打码（覆盖 R2 等没有固定格式的密钥）
#   2. install_output_redaction()：替换 sys.stdout / sys.stderr，print、traceback、uvicorn 日志输出前统一打码
#   3. main.py 里的异常处理器：返回给浏览器的错误提示同样经过 redact()
# ============================================================================

import os
import re
import sys

MASK = "…（已隐藏）"

_PATTERNS = [
    (re.compile(r"\b((?:sk|rk)_(?:live|test)_)[A-Za-z0-9]{6,}"), r"\1" + MASK),
    (re.compile(r"\b(whsec_)[A-Za-z0-9]{6,}"), r"\1" + MASK),
    (re.compile(r"\b(sb_secret_)[A-Za-z0-9_\-]{6,}"), r"\1" + MASK),
    (re.compile(r"\b(AIza)[0-9A-Za-z_\-]{20,}"), r"\1" + MASK),
    (re.compile(r"\b(eyJ)[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"), r"\1" + MASK),
]

_SECRET_NAME = re.compile(r"(KEY|SECRET|TOKEN|PASSWORD)", re.I)
_secret_values: list = []


def _load_secret_values():
    """收集环境变量里的密钥值（去掉首尾空白），长的先替换，避免部分重叠。"""
    vals = set()
    for name, v in os.environ.items():
        if not v or not _SECRET_NAME.search(name):
            continue
        v = v.strip()
        if len(v) >= 12:            # 太短的值（如布尔开关）不当作密钥，避免误伤正常文字
            vals.add(v)
    return sorted(vals, key=len, reverse=True)


def redact(text) -> str:
    if text is None:
        return text
    s = text if isinstance(text, str) else str(text)
    global _secret_values
    if not _secret_values:
        _secret_values = _load_secret_values()
    for pat, rep in _PATTERNS:          # 先按格式打码（保留 sk_live_ 等前缀，便于看出是哪类密钥）
        s = pat.sub(rep, s)
    for v in _secret_values:            # 再按环境变量里的值打码（R2 等无固定格式的密钥）
        if v in s:
            s = s.replace(v, v[:4] + MASK)
    return s


def redact_obj(obj):
    """递归打码 dict / list 里的字符串（用于 HTTPException 的 detail）。"""
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, dict):
        return {k: redact_obj(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [redact_obj(v) for v in obj]
    return obj


class _RedactingStream:
    def __init__(self, stream):
        self._stream = stream

    def write(self, s):
        try:
            return self._stream.write(redact(s))
        except Exception:
            return self._stream.write(s)

    def __getattr__(self, name):
        return getattr(self._stream, name)


def install_output_redaction():
    """让进程的标准输出、标准错误在写出前统一打码（可重复调用）。"""
    if not isinstance(sys.stdout, _RedactingStream):
        sys.stdout = _RedactingStream(sys.stdout)
    if not isinstance(sys.stderr, _RedactingStream):
        sys.stderr = _RedactingStream(sys.stderr)


# ---- 日志：uvicorn 等在启动时已经握住了原始 stderr，单换 sys.stderr 管不到，另加过滤器 ----
import logging

_fmt = logging.Formatter()


class RedactFilter(logging.Filter):
    def filter(self, record):
        try:
            msg = record.getMessage()
            safe = redact(msg)
            if safe != msg:              # 只在确实含密钥时改写，避免影响依赖 args 的格式化器
                record.msg = safe
                record.args = None
            if record.exc_info and not record.exc_text:
                record.exc_text = redact(_fmt.formatException(record.exc_info))
            elif record.exc_text:
                record.exc_text = redact(record.exc_text)
        except Exception:
            pass
        return True


def install_log_redaction():
    """给根日志器与 uvicorn 各日志器的现有处理器挂上打码过滤器（可重复调用）。"""
    # 不含 uvicorn.access：它的格式化器依赖 record.args，且访问日志只记方法、路径和状态码
    for name in ("", "uvicorn", "uvicorn.error", "fastapi"):
        lg = logging.getLogger(name)
        targets = [lg] + list(lg.handlers)
        for t in targets:
            if not any(isinstance(f, RedactFilter) for f in t.filters):
                t.addFilter(RedactFilter())
