from __future__ import annotations

"""统一安全检测器。

覆盖能力（对应感知层优化方案问题 5）：
- Prompt Injection / 越狱攻击检测（正则模式库）
- PII 识别（手机号 / 身份证 / 银行卡 / 邮箱 / IP）
- 注入清洗（HTML / SQL / Shell 关键字标记）
- 安全评分（综合敏感词、注入风险、PII 结果）

设计原则：
- 仅依赖标准库，避免引入 presidio / llm-guard 等重依赖
- 所有检测返回结构化结果，由调用方决定是否拒绝
- 提供 ``detect_all`` 一次性完成全部检测
"""

import re
from typing import Any, Dict, List, Tuple


# ---------------------------------------------------------------------------
# Prompt Injection / 越狱攻击模式库
# ---------------------------------------------------------------------------

_INJECTION_PATTERNS: List[re.Pattern] = [
    re.compile(p, re.IGNORECASE) for p in [
        r"忽略(?:以上|之前|前面|上述)(?:的)?(?:指令|提示|规则|设定)",
        r"ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions",
        r"disregard\s+(?:the\s+)?(?:above|previous|prior)\s+(?:instructions?|rules?)",
        r"你(?:现在)?(?:是|扮演|充当)\s*(?:DAN|AIM|越狱|jailbreak|developer\s*mode)",
        r"(?:reveal|show|print|leak|dump)\s+(?:your\s+)?(?:system\s+)?prompt",
        r"(?:进入|开启|启用)\s*(?:开发者|developer|越狱|jailbreak|root)\s*模式",
        r"pretend\s+(?:you\s+are|to\s+be)\s+(?:an?\s+)?(?:DAN|AIM|unrestricted)",
        r"(?:从现在|now)\s*(?:起)?\s*(?:你|you)\s*(?:是|are)\s*(?:free|unrestricted|liberated)",
        r"(?:无限制|unlimited|no\s+restrictions?)\s*模式",
        r"你的?(?:系统|初始|原始)\s*提示词",
        r"role\s*:\s*system",
        r"<\|im_start\|>",
        r"\[/inst\]",
        r"jailbreak",
    ]
]

# ---------------------------------------------------------------------------
# PII 正则模式库
# ---------------------------------------------------------------------------

_PII_PATTERNS: Dict[str, re.Pattern] = {
    "phone_cn": re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    "id_card_cn": re.compile(
        r"(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)"
    ),
    "bank_card": re.compile(r"(?<!\d)[1-9]\d{14,18}(?!\d)"),
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    "ipv4": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
}

# ---------------------------------------------------------------------------
# 注入清洗模式（标记而非拒绝）
# ---------------------------------------------------------------------------

_INJECTION_RISK_PATTERNS: Dict[str, re.Pattern] = {
    "html_tag": re.compile(r"<(?:script|iframe|img|svg|on\w+)[^>]*>", re.IGNORECASE),
    "sql_keyword": re.compile(
        r"\b(?:union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+set|or\s+1=1|--)\b",
        re.IGNORECASE,
    ),
    "shell_meta": re.compile(r"(?:;\s*(?:rm|cat|wget|curl|bash|sh)\b|\$\(|`|\|\|\s*\w+)"),
}


class SecurityGuard:
    """统一安全检测器。

    在 ``TextPreprocessor`` 内部调用，输出结构化安全信息，由调用方决定后续策略。
    所有方法均为纯函数式调用，无副作用。
    """

    def detect_injection(self, text: str) -> Dict[str, Any]:
        """检测 Prompt Injection / 越狱攻击尝试。

        Returns:
            ``{"detected": bool, "matched_patterns": List[str], "risk_level": int}``
            risk_level: 0=安全, 1=疑似, 2=高风险, 3=极高风险
        """
        matched: List[str] = []
        risk_level = 0
        for pattern in _INJECTION_PATTERNS:
            m = pattern.search(text)
            if m:
                matched.append(m.group(0)[:50])
                risk_level = max(risk_level, 3 if "jailbreak" in m.group(0).lower() else 2)
        return {
            "detected": bool(matched),
            "matched_patterns": matched,
            "risk_level": risk_level,
        }

    def detect_pii(self, text: str) -> Dict[str, Any]:
        """检测 PII（个人隐私信息）。

        Returns:
            ``{"detected": bool, "types": List[str], "matches": Dict[str, List[str]]}``
        """
        types: List[str] = []
        matches: Dict[str, List[str]] = {}
        for pii_type, pattern in _PII_PATTERNS.items():
            found = pattern.findall(text)
            if found:
                # 脱敏：仅保留前 3 位 + ***
                masked = [f"{s[:3]}***" for s in found[:5]]
                types.append(pii_type)
                matches[pii_type] = masked
        return {
            "detected": bool(types),
            "types": types,
            "matches": matches,
        }

    def detect_injection_risk(self, text: str) -> Dict[str, Any]:
        """检测 HTML/SQL/Shell 注入风险（标记而非拒绝）。

        Returns:
            ``{"detected": bool, "risk_types": List[str], "details": Dict[str, int]}``
        """
        risk_types: List[str] = []
        details: Dict[str, int] = {}
        for risk_type, pattern in _INJECTION_RISK_PATTERNS.items():
            count = len(pattern.findall(text))
            if count > 0:
                risk_types.append(risk_type)
                details[risk_type] = count
        return {
            "detected": bool(risk_types),
            "risk_types": risk_types,
            "details": details,
        }

    def sanitize(self, text: str) -> Tuple[str, Dict[str, Any]]:
        """清洗输入中的注入风险字符。

        当前策略：仅标记不修改原文，返回风险信息供调用方决策。
        未来可扩展为实际转义/删除。
        """
        risk_info = self.detect_injection_risk(text)
        return text, risk_info

    def compute_security_score(
        self,
        injection_result: Dict[str, Any],
        pii_result: Dict[str, Any],
        injection_risk_result: Dict[str, Any],
        sensitivity_level: int = 0,
    ) -> float:
        """综合计算安全评分（0~1，1 为最安全）。

        评分因子权重：
        - Prompt Injection: 40%（最严重）
        - PII: 25%
        - 注入风险: 20%
        - 敏感词级别: 15%
        """
        score = 1.0

        # Prompt Injection 扣分
        if injection_result.get("detected"):
            risk = injection_result.get("risk_level", 0)
            score -= 0.4 * (risk / 3.0)

        # PII 扣分
        if pii_result.get("detected"):
            pii_types = len(pii_result.get("types", []))
            score -= 0.25 * min(pii_types * 0.3, 1.0)

        # 注入风险扣分
        if injection_risk_result.get("detected"):
            risk_count = sum(injection_risk_result.get("details", {}).values())
            score -= 0.2 * min(risk_count * 0.2, 1.0)

        # 敏感词级别扣分
        score -= 0.15 * (sensitivity_level / 5.0)

        return max(0.0, min(1.0, round(score, 3)))

    def detect_all(self, text: str, sensitivity_level: int = 0) -> Dict[str, Any]:
        """一次性完成全部安全检测。

        Returns:
            包含 injection / pii / injection_risk / security_score 的综合结果
        """
        injection = self.detect_injection(text)
        pii = self.detect_pii(text)
        injection_risk = self.detect_injection_risk(text)
        security_score = self.compute_security_score(
            injection, pii, injection_risk, sensitivity_level
        )
        return {
            "injection": injection,
            "pii": pii,
            "injection_risk": injection_risk,
            "security_score": security_score,
            "injection_detected": injection.get("detected", False),
            "pii_detected": pii.get("detected", False),
        }
