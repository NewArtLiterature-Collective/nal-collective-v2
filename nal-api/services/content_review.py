# services/content_review.py
# ============================================================================
# 文字作品"整本内容研判"共享模块（cr1，2026-11-09 主编确认）
# 与离线评审引擎 lit_engine 的初审内容研判同一套提示词、处置规则、防编造与防翻转机制。
# 线上的 literary_llm_service、contest_literary_service（文字部分）都调用这里，改一处即全部生效。
#
# 判断原则（主编确认）：
#   一段描写算不算越线，不能脱离上下文来定；但真正越线的描写，全书立场再正当也抵消不了。
# 处置：
#   hold      🚫 拦截：情色越线；作品整体以成人两性话题为主；暴力血腥越线且篇幅"大量"或全书结论"不适合"
#   platform  🚫 转人工：整本被平台拦截（不返回文本，实测基本都是真有问题的作品）
#   disagree  🚫 转人工：两次研判一个拦、一个不拦
#   error     🚫 转人工（批处理）/ 请稍后重试（在线）：接口异常，两次都取不到结论
#   flag      ⚠️ 标注、不阻断：其他越线（零星暴力血腥、自伤、危险行为、成瘾）
#   pass      ✅ 通过（可能附"不越线但需留意"的记录，只供查阅）
# 防编造：拦截依据的原句必须能在正文中定位，定位不到的不作拦截依据（列入 unverified）。
# 防翻转：第一次不是"适合且未列出任何段落"的，补跑第二次；拦与不拦两次一致才采信。
#   离线批处理（lit_engine）：不一致 → 转人工。
#   线上即时服务（tiebreak=True）：不一致 → 补跑第三次，按多数（三次中两次）定结论，当场给出结果。
# 平台拦截与接口异常严格区分：前者是信号（转人工），后者不是作品的问题（绝不当作"通过"）。
# ============================================================================
import re
import json
import asyncio
from difflib import SequenceMatcher

try:
    from google.genai import types
except Exception:          # 仅用于构造 safety_settings；缺失时按平台默认设置调用
    types = None

CONTENT_REVIEW_VER = "cr1"

# 送审上限：中文 20 万字、外文 90 万字符（与 lit_engine 一致）
DOC_MAXCHARS = 200000
DOC_MAXCHARS_LATIN = 900000
LATIN_SCALE = 3

CR_SYS = "你是青少年读物出版社的资深编辑，负责在初审时通读书稿，判断它是否适合青少年读者。判断必须以原文和全书语境为据。"

CR_PROMPT = """【任务】请通读下面的作品全文，对它是否适合 10 岁以上的青少年读者做内容研判。

【判断原则】
1. 一段描写算不算越线，要看它在上下文中的作用、意图和全书基调，不能因为写到身体、亲昵、死亡、伤痛的个别字句就下结论。
2. 真正越线的描写，全书立场再正当也抵消不了。

【越线指的是】
- 以性为指向的描写：带性暗示的身体描写、感官化的性亲密、性行为；
- 作品整体以成人两性话题为主要内容（如贞操、卖淫、通奸、性病等性道德议题被反复讨论），即使没有露骨描写，类型也记为"性"；
- 血腥、残忍的暴力细节被具体铺陈（伤口、酷刑、肢解等），而非一笔带过；
- 自伤、自杀的方法或过程被具体描写或美化；
- 儿童可能模仿的危险行为被步骤化地描写，且未呈现后果；
- 吸毒、酗酒等成瘾行为被正面化或细节化。

【不算越线】外貌与神态刻画、赞美、亲情亲昵、恋爱好感与古典含蓄的爱情、死亡与疾病、离别与贫困、
欺凌与冲突（未作血腥铺陈）、民俗、动物的捕食与繁衍。沉重的题材本身不是问题。
绝大多数儿童文学作品不会有任何需要列出的段落；拿不准时说明理由。

【篇幅】对每一类问题，说明它在全书中的分量：一处 / 多处 / 大量（反复铺陈或贯穿全书）。

只输出 JSON：
{"overall":"适合 / 需留意 / 不适合（三选一）",
 "tone":"一句话概括全书基调",
 "issues":[{"quote":"原文，不超过40字","location":"第几章或大致位置","type":"性 / 暴力血腥 / 自伤 / 危险行为 / 成瘾",
            "extent":"一处 / 多处 / 大量","function":"它在上下文中的作用",
            "judgment":"越线 / 不越线但需留意","reason":"依据原文与语境的理由"}]}
"""

FOREIGN_NOTE = ("\n【外文作品说明】本作品原文为外文。理由等说明一律用简体中文书写；"
                "quote 必须照录外文原句，不得先译成中文。按原文本身判断，不因它是外文而从宽或从严。")

# 两类"转人工"/拦截的统一说明（供各服务拼提示语）
DECISION_LABELS = {
    "hold": "越线，不予通过",
    "platform": "整本未能通过平台的内容审核，须人工复核",
    "disagree": "两次研判结论不一致，须人工复核",
    "error": "内容研判暂时无法完成",
}
BLOCKING = ("hold", "platform", "disagree", "error")


# ---------- 工具 ----------
_CJK_RE = re.compile(r"[㐀-鿿豈-﫿]")
_LATIN_RE = re.compile(r"[A-Za-zÀ-ɏ]")
_ELLIPSIS_RE = re.compile(r"……|…|\.{3,}|⋯+|——")
QUOTE_MIN_LEN = 8
QUOTE_FUZZY_RATIO = 0.9


def as_text(v) -> str:
    if isinstance(v, (list, tuple)):
        v = v[0] if v else ""
    if isinstance(v, dict):
        v = next(iter(v.values()), "") if v else ""
    return str(v).strip() if v is not None else ""


def is_latin_text(text: str) -> bool:
    """正文以拉丁字母为主（英文等外文作品）→ True。"""
    sample = (text or "")[:20000]
    cjk = len(_CJK_RE.findall(sample))
    lat = len(_LATIN_RE.findall(sample))
    return lat > 200 and cjk < lat * 0.05


def _norm(s: str) -> str:
    return re.sub(r"[\W_]+", "", s or "", flags=re.UNICODE).lower()


def quote_located(quote: str, text: str) -> bool:
    """原句能否在正文中定位（去标点空白后比对；省略号视为断点，前后各段分别定位；过短的片段不核）。
    正文为空时无法核对，按"可定位"处理（不因无法核对而放过越线）。"""
    norm_text = _norm(text)
    if not norm_text:
        return True
    min_len = QUOTE_MIN_LEN * (LATIN_SCALE if is_latin_text(text) else 1)
    frags = [f for f in (_norm(x) for x in _ELLIPSIS_RE.split(quote or "")) if len(f) >= min_len]
    if not frags:
        return True
    for f in frags:
        if f in norm_text:
            continue
        m = SequenceMatcher(None, norm_text, f, autojunk=False).find_longest_match(0, len(norm_text), 0, len(f))
        if m.size < max(1, int(len(f) * QUOTE_FUZZY_RATIO)):
            return False
    return True


def moderation_safety_settings():
    """研判调用关闭可调的拦截阈值：审查模型必须先看到内容才能判断。
    注意：平台的 PROHIBITED_CONTENT 属于输入阶段的过滤，关不掉——这正是 platform 结论的来源。"""
    if types is None:
        return None
    try:
        cats = [types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT]
        return [types.SafetySetting(category=c, threshold=types.HarmBlockThreshold.BLOCK_NONE) for c in cats]
    except Exception:
        return None


_BLOCK_FINISH = ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY")


def platform_blocked(res) -> bool:
    """响应是否为平台拦截：输入阶段 block_reason，或候选因安全原因结束且没有文本。"""
    if res is None:
        return False
    try:
        pf = getattr(res, "prompt_feedback", None)
        if pf and getattr(pf, "block_reason", None):
            return True
        cands = getattr(res, "candidates", None) or []
        if cands:
            fr = str(getattr(cands[0], "finish_reason", "") or "")
            parts = getattr(getattr(cands[0], "content", None), "parts", None)
            if not parts and any(k in fr for k in _BLOCK_FINISH):
                return True
    except Exception:
        pass
    return False


def response_text(res) -> str:
    try:
        return (res.text or "") if res is not None else ""
    except Exception:
        return ""


def diag(res) -> str:
    """失败时的简要诊断（只记录）。"""
    if res is None:
        return "无响应对象"
    out = []
    try:
        pf = getattr(res, "prompt_feedback", None)
        if pf and getattr(pf, "block_reason", None):
            out.append(f"block_reason={pf.block_reason}")
        cands = getattr(res, "candidates", None) or []
        if cands:
            out.append(f"finish_reason={getattr(cands[0], 'finish_reason', None)}")
    except Exception as e:
        out.append(f"诊断异常={e}")
    return " | ".join(out) or "无文本返回"


async def call_json(gen, contents, system_instruction: str, attempts: int = 2):
    """调用并解析 JSON。返回 (dict 或 None, 是否平台拦截, 诊断)。
    平台拦截立即返回（重试没有意义）；接口异常或 JSON 不规整重试，仍失败返回 (None, False, 诊断)。
    gen: async callable(contents, system_instruction, **cfg) -> 响应对象"""
    last = ""
    for k in range(attempts):
        res = None
        try:
            res = await gen(contents, system_instruction, temperature=0.0,
                            safety_settings=moderation_safety_settings())
        except Exception as e:
            last = f"接口调用异常：{type(e).__name__}: {str(e)[:200]}"
        else:
            if platform_blocked(res):
                return None, True, diag(res)
            txt = response_text(res)
            if txt:
                try:
                    d = json.loads(txt.replace("```json", "").replace("```", "").strip())
                    if isinstance(d, list):
                        d = d[0] if d else {}
                    if isinstance(d, dict):
                        return d, False, ""
                    last = "JSON 不是对象"
                except Exception as e:
                    last = f"JSON解析失败：{e}"
            else:
                last = diag(res)
        if k + 1 < attempts:
            await asyncio.sleep(1.5 * (k + 1))
    return None, False, last


# ---------- 研判 ----------
def classify(d: dict, text: str) -> dict:
    """把一次研判结果分成 拦截 / 标注 / 记录；拦截依据的原句须能在正文定位。"""
    hold, flag, note, unverified = [], [], [], []
    overall = as_text(d.get("overall", ""))
    for i in (d.get("issues") or []):
        if not isinstance(i, dict):
            continue
        over = as_text(i.get("judgment", "")).startswith("越线")
        t, ext = as_text(i.get("type", "")), as_text(i.get("extent", ""))
        if not over:
            note.append(i)
            continue
        is_hold = ("性" in t and "暴力" not in t) or ("暴力" in t and ("大量" in ext or overall.startswith("不适合")))
        if is_hold and text and not quote_located(as_text(i.get("quote", "")), text):
            unverified.append(dict(i, quote_unlocated=True))      # 原句定位不到：不作拦截依据
            continue
        (hold if is_hold else flag).append(i)
    return {"overall": overall, "tone": as_text(d.get("tone", "")),
            "hold": hold, "flag": flag, "note": note, "unverified": unverified,
            "decision": "hold" if hold else ("flag" if flag else "pass")}


def build_contents(text: str) -> str:
    text = text or ""
    cap = DOC_MAXCHARS_LATIN if is_latin_text(text) else DOC_MAXCHARS
    return (CR_PROMPT + (FOREIGN_NOTE if is_latin_text(text) else "")
            + "\n\n【作品全文】：\n" + text[:cap])


async def review_text(text: str, gen, tiebreak: bool = False) -> dict:
    """整本内容研判（含防翻转复核）。tiebreak=True（线上服务）：两次不一致时补跑第三次按多数定。
    返回 {"ver","decision","final","runs","diag","truncated"}；decision ∈ pass/flag/hold/platform/disagree/error。"""
    text = text or ""
    res = {"ver": CONTENT_REVIEW_VER, "runs": [], "diag": "",
           "truncated": len(text) > (DOC_MAXCHARS_LATIN if is_latin_text(text) else DOC_MAXCHARS)}
    if not text.strip():
        res.update(decision="pass", final=classify({}, ""))
        return res
    contents = build_contents(text)
    d1, blocked, dg = await call_json(gen, contents, CR_SYS)
    if d1 is None:
        res.update(decision="platform" if blocked else "error", diag=dg)
        return res
    c1 = classify(d1, text)
    res["runs"].append(c1)
    if c1["overall"].startswith("适合") and not (d1.get("issues") or []):
        res.update(decision="pass", final=c1)
        return res
    d2, blocked2, dg2 = await call_json(gen, contents, CR_SYS)         # 非干净作品：补跑第二次
    if d2 is None:
        # 第二次被平台拦：整本拦截信号；第二次接口失败：无法复核
        #   离线：按不一致转人工（与 lit_engine 一致）；线上：接口故障，请稍后重试
        res.update(decision="platform" if blocked2 else ("error" if tiebreak else "disagree"), diag=dg2, final=c1)
        return res
    c2 = classify(d2, text)
    res["runs"].append(c2)
    h1, h2 = c1["decision"] == "hold", c2["decision"] == "hold"
    if h1 != h2:
        if not tiebreak:
            res.update(decision="disagree", final=c1 if h1 else c2)
            return res
        d3, blocked3, dg3 = await call_json(gen, contents, CR_SYS)     # 线上：第三次定多数
        if d3 is None:
            res.update(decision="platform" if blocked3 else "error", diag=dg3, final=c1 if h1 else c2)
            return res
        c3 = classify(d3, text)
        res["runs"].append(c3)
        res["tiebreak"] = True
        if c3["decision"] == "hold":
            res.update(decision="hold", final=c1 if h1 else c2)
        else:
            keep = c2 if h1 else c1                                  # 判为不拦的那一次
            final = keep if (keep["flag"] or not c3["flag"]) else c3
            res.update(decision=final["decision"], final=final)
        return res
    final = c1 if (h1 or c1["flag"] or not c2["flag"]) else c2      # 都拦以第一次为准；都不拦时有标注的优先
    res.update(decision=final["decision"], final=final)
    return res


def issue_line(i: dict) -> str:
    """一条列出段落的简要文字：类型｜位置｜「原句」｜理由。"""
    bits = [as_text(i.get("type")), as_text(i.get("location"))]
    q = as_text(i.get("quote"))
    s = "｜".join(b for b in bits if b)
    if q:
        s += f"｜「{q}」"
    r = as_text(i.get("reason"))
    if r:
        s += f"：{r}"
    if i.get("quote_unlocated"):
        s += "（所引原句未能在正文中定位，不作拦截依据）"
    return s


def hold_label(final: dict) -> str:
    """拦截类型的对外说法。"""
    types_ = [as_text(i.get("type")) for i in (final or {}).get("hold", [])]
    if any("暴力" in t for t in types_) and not any("性" in t and "暴力" not in t for t in types_):
        return "大量或不适合青少年的暴力血腥描写"
    return "以性为指向的描写，或以成人两性话题为主要内容"
