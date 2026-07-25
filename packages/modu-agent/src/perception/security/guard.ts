// 对应 Python: components/perception/security/guard.py
// 统一安全检测器
//
// 覆盖能力（对应感知层优化方案问题 5）：
// - Prompt Injection / 越狱攻击检测（正则模式库）
// - PII 识别（手机号 / 身份证 / 银行卡 / 邮箱 / IP）
// - 注入清洗（HTML / SQL / Shell 关键字标记）
// - 安全评分（综合敏感词、注入风险、PII 结果）
//
// 设计原则：
// - 仅依赖标准库，避免引入 presidio / llm-guard 等重依赖
// - 所有检测返回结构化结果，由调用方决定是否拒绝
// - 提供 detectAll 一次性完成全部检测

// ---------------------------------------------------------------------------
// Prompt Injection / 越狱攻击模式库
// ---------------------------------------------------------------------------

const _INJECTION_PATTERNS: RegExp[] = [
  /忽略(?:以上|之前|前面|上述)(?:的)?(?:指令|提示|规则|设定)/i,
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:the\s+)?(?:above|previous|prior)\s+(?:instructions?|rules?)/i,
  /你(?:现在)?(?:是|扮演|充当)\s*(?:DAN|AIM|越狱|jailbreak|developer\s*mode)/i,
  /(?:reveal|show|print|leak|dump)\s+(?:your\s+)?(?:system\s+)?prompt/i,
  /(?:进入|开启|启用)\s*(?:开发者|developer|越狱|jailbreak|root)\s*模式/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+(?:an?\s+)?(?:DAN|AIM|unrestricted)/i,
  /(?:从现在|now)\s*(?:起)?\s*(?:你|you)\s*(?:是|are)\s*(?:free|unrestricted|liberated)/i,
  /(?:无限制|unlimited|no\s+restrictions?)\s*模式/i,
  /你的?(?:系统|初始|原始)\s*提示词/i,
  /role\s*:\s*system/i,
  /<\|im_start\|>/,
  /\[\/inst\]/,
  /jailbreak/i,
]

// ---------------------------------------------------------------------------
// PII 正则模式库
// ---------------------------------------------------------------------------

const _PII_PATTERNS: Record<string, RegExp> = {
  phone_cn: /(?<!\d)1[3-9]\d{9}(?!\d)/,
  id_card_cn: /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/,
  bank_card: /(?<!\d)[1-9]\d{14,18}(?!\d)/,
  email: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
}

// ---------------------------------------------------------------------------
// 注入清洗模式（标记而非拒绝）
// ---------------------------------------------------------------------------

const _INJECTION_RISK_PATTERNS: Record<string, RegExp> = {
  html_tag: /<(?:script|iframe|img|svg|on\w+)[^>]*>/gi,
  sql_keyword: /\b(?:union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+set|or\s+1=1|--)\b/gi,
  shell_meta: /(?:;\s*(?:rm|cat|wget|curl|bash|sh)\b|\$\(|`|\|\|\s*\w+)/,
}

// ---------------------------------------------------------------------------
// 输出敏感信息模式（对应文档 §2.5 建议5：输出敏感信息检测）
// ---------------------------------------------------------------------------

// 密钥/凭证模式（常见格式）
const _SECRET_PATTERNS: Record<string, RegExp> = {
  // AWS Access Key ID（20 位大写字母数字）
  aws_access_key_id: /(?:^|[^A-Z0-9])(AKIA[0-9A-Z]{16})(?:[^A-Z0-9]|$)/g,
  // AWS Secret Access Key（40 位 base64）
  aws_secret_key: /(?:aws_secret_access_key|aws_secret)[\s:=]+['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
  // GitHub Token（ghp_ / gho_ / ghs_ / ghu_ 前缀 + 36 位）
  github_token: /\b(gh[pousr]_[A-Za-z0-9]{36})\b/g,
  // Generic API Key（api_key=xxx 形式）
  api_key_generic: /(?:api[_-]?key|apikey)[\s:=]+['"]?([A-Za-z0-9_\-]{32,})['"]?/gi,
  // Bearer Token
  bearer_token: /\b(Bearer\s+[A-Za-z0-9_\-\.=]{20,})\b/gi,
  // Private Key PEM
  private_key_pem: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE\s+KEY-----/g,
  // JWT（三段式 base64）
  jwt: /\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g,
}

// 内网 IP 模式（用于输出检测，防止 LLM 泄漏内网拓扑）
const _INTERNAL_IP_PATTERNS: RegExp[] = [
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
  /\b(?:172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
  /\b(?:192\.168\.\d{1,3}\.\d{1,3})\b/g,
  /\b(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
  /\b(?:169\.254\.\d{1,3}\.\d{1,3})\b/g,
]

/**
 * 统一安全检测器。
 * 对应 Python SecurityGuard。
 *
 * 在 TextPreprocessor 内部调用，输出结构化安全信息，由调用方决定后续策略。
 * 所有方法均为纯函数式调用，无副作用。
 */
export class SecurityGuard {
  /**
   * 检测 Prompt Injection / 越狱攻击尝试。
   * 对应 Python detect_injection。
   *
   * @returns {detected, matchedPatterns, riskLevel}
   *   riskLevel: 0=安全, 1=疑似, 2=高风险, 3=极高风险
   */
  detectInjection(text: string): Record<string, any> {
    const matched: string[] = []
    let riskLevel = 0
    for (const pattern of _INJECTION_PATTERNS) {
      const m = text.match(pattern)
      if (m) {
        matched.push(m[0].slice(0, 50))
        riskLevel = Math.max(riskLevel, m[0].toLowerCase().includes('jailbreak') ? 3 : 2)
      }
    }
    return {
      detected: matched.length > 0,
      matched_patterns: matched,
      risk_level: riskLevel,
    }
  }

  /**
   * LLM-based Prompt 注入二次校验（对应文档 §2.5 建议1）。
   *
   * 策略：
   *   1. 先执行关键词检测（detectInjection），命中高风险则直接返回
   *   2. 关键词检测未命中或低风险时，调用 LLM judge 做语义级二次校验
   *   3. LLM 失败时回退到关键词检测结果（不阻塞主流程）
   *
   * 设计要点：
   *   - 不修改现有同步 detectInjection API，新增独立 async 方法
   *   - LLM judge 通过参数注入（callable），不与 ModuLLM 硬耦合
   *   - riskThreshold 控制是否触发 LLM（关键词已高风险时跳过，节省成本）
   *
   * @param text           待检测文本
   * @param llmJudge       LLM 判定回调，返回 { detected, reason? }
   * @param riskThreshold  关键词 risk_level >= 此值时跳过 LLM（默认 1）
   * @returns 关键词检测结果 + 可选的 llm_judgment 字段
   */
  async detectInjectionWithLLMJudge(
    text: string,
    llmJudge: ((text: string) => Promise<{ detected: boolean; reason?: string }>) | null,
    riskThreshold: number = 1,
  ): Promise<Record<string, any>> {
    const keywordResult = this.detectInjection(text)

    // 关键词已判定高风险 → 直接返回，无需 LLM 二次校验
    if (keywordResult.detected && (keywordResult.risk_level ?? 0) >= riskThreshold) {
      return keywordResult
    }

    // 无 LLM judge → 返回关键词结果
    if (llmJudge === null) {
      return keywordResult
    }

    // LLM 二次校验
    try {
      const llmResult = await llmJudge(text)
      return {
        ...keywordResult,
        // LLM 判定注入 → 合并结果，提升 risk_level
        detected: keywordResult.detected || llmResult.detected,
        risk_level: llmResult.detected
          ? Math.max(keywordResult.risk_level ?? 0, 1)  // LLM 检出至少标记为疑似(1)
          : keywordResult.risk_level,
        llm_judgment: {
          detected: llmResult.detected,
          reason: llmResult.reason ?? '',
        },
      }
    } catch {
      // LLM 调用失败 → 回退到关键词结果，不阻塞主流程
      return keywordResult
    }
  }

  /**
   * 检测 PII（个人隐私信息）。
   * 对应 Python detect_pii。
   *
   * @returns {detected, types, matches}
   */
  detectPii(text: string): Record<string, any> {
    const types: string[] = []
    const matches: Record<string, string[]> = {}
    for (const [piiType, pattern] of Object.entries(_PII_PATTERNS)) {
      const found = text.match(pattern) ?? []
      if (found.length > 0) {
        // 脱敏：仅保留前 3 位 + ***
        const masked = found.slice(0, 5).map((s) => `${s.slice(0, 3)}***`)
        types.push(piiType)
        matches[piiType] = masked
      }
    }
    return {
      detected: types.length > 0,
      types,
      matches,
    }
  }

  /**
   * 检测 HTML/SQL/Shell 注入风险（标记而非拒绝）。
   * 对应 Python detect_injection_risk。
   *
   * @returns {detected, riskTypes, details}
   */
  detectInjectionRisk(text: string): Record<string, any> {
    const riskTypes: string[] = []
    const details: Record<string, number> = {}
    for (const [riskType, pattern] of Object.entries(_INJECTION_RISK_PATTERNS)) {
      const matches = text.match(pattern)
      const count = matches ? matches.length : 0
      if (count > 0) {
        riskTypes.push(riskType)
        details[riskType] = count
      }
    }
    return {
      detected: riskTypes.length > 0,
      risk_types: riskTypes,
      details,
    }
  }

  /**
   * 清洗输入中的注入风险字符。
   * 对应 Python sanitize。
   *
   * 当前策略：仅标记不修改原文，返回风险信息供调用方决策。
   */
  sanitize(text: string): [string, Record<string, any>] {
    const riskInfo = this.detectInjectionRisk(text)
    return [text, riskInfo]
  }

  /**
   * 综合计算安全评分（0~1，1 为最安全）。
   * 对应 Python compute_security_score。
   *
   * 评分因子权重：
   * - Prompt Injection: 40%（最严重）
   * - PII: 25%
   * - 注入风险: 20%
   * - 敏感词级别: 15%
   */
  computeSecurityScore(
    injectionResult: Record<string, any>,
    piiResult: Record<string, any>,
    injectionRiskResult: Record<string, any>,
    sensitivityLevel: number = 0,
  ): number {
    let score = 1.0

    // Prompt Injection 扣分
    if (injectionResult.detected) {
      const risk = injectionResult.risk_level ?? 0
      score -= 0.4 * (risk / 3.0)
    }

    // PII 扣分
    if (piiResult.detected) {
      const piiTypes = (piiResult.types ?? []).length
      score -= 0.25 * Math.min(piiTypes * 0.3, 1.0)
    }

    // 注入风险扣分
    if (injectionRiskResult.detected) {
      const riskCount = Object.values(injectionRiskResult.details ?? {}).reduce((a: number, b: any) => a + b, 0)
      score -= 0.2 * Math.min(riskCount * 0.2, 1.0)
    }

    // 敏感词级别扣分
    score -= 0.15 * (sensitivityLevel / 5.0)

    return Math.max(0.0, Math.min(1.0, Math.round(score * 1000) / 1000))
  }

  /**
   * 一次性完成全部安全检测。
   * 对应 Python detect_all。
   *
   * @returns 包含 injection / pii / injection_risk / security_score 的综合结果
   */
  detectAll(text: string, sensitivityLevel: number = 0): Record<string, any> {
    const injection = this.detectInjection(text)
    const pii = this.detectPii(text)
    const injectionRisk = this.detectInjectionRisk(text)
    const securityScore = this.computeSecurityScore(
      injection, pii, injectionRisk, sensitivityLevel,
    )
    return {
      injection,
      pii,
      injection_risk: injectionRisk,
      security_score: securityScore,
      injection_detected: injection.detected ?? false,
      pii_detected: pii.detected ?? false,
    }
  }

  /**
   * 检测输出中的敏感信息（对应文档 §2.5 建议5）。
   *
   * 检测维度：
   *   - 密钥/凭证：AWS Key、GitHub Token、API Key、Bearer Token、PEM 私钥、JWT
   *   - 内网 IP：10.x / 172.16-31.x / 192.168.x / 127.x / 169.254.x
   *   - PII：复用 detectPii 结果
   *
   * @returns {detected, secret_types, pii_types, internal_ips, details}
   */
  detectOutputSensitive(text: string): Record<string, any> {
    const secretTypes: string[] = []
    const secretMatches: Record<string, string[]> = {}
    for (const [secretType, pattern] of Object.entries(_SECRET_PATTERNS)) {
      // 重置 lastIndex（全局正则复用）
      pattern.lastIndex = 0
      const found = text.match(pattern) ?? []
      if (found.length > 0) {
        // 脱敏：仅保留前 4 位 + ***
        const masked = found.slice(0, 3).map((s) => `${s.slice(0, 4)}***`)
        secretTypes.push(secretType)
        secretMatches[secretType] = masked
      }
    }

    const internalIps: string[] = []
    for (const pattern of _INTERNAL_IP_PATTERNS) {
      pattern.lastIndex = 0
      const found = text.match(pattern) ?? []
      if (found.length > 0) {
        // 去重，最多保留 5 个
        const unique = Array.from(new Set(found)).slice(0, 5)
        internalIps.push(...unique)
      }
    }

    const piiResult = this.detectPii(text)

    const detected =
      secretTypes.length > 0 ||
      internalIps.length > 0 ||
      piiResult.detected

    return {
      detected,
      secret_types: secretTypes,
      secret_matches: secretMatches,
      pii_types: piiResult.types ?? [],
      pii_matches: piiResult.matches ?? {},
      internal_ips: internalIps,
    }
  }

  /**
   * 清洗输出中的敏感信息（对应文档 §2.5 建议5）。
   *
   * 策略：
   *   - 密钥/凭证：替换为 [REDACTED:类型名]
   *   - 内网 IP：替换为 [REDACTED:INTERNAL_IP]
   *   - PII：手机号/身份证/银行卡替换为 [REDACTED:类型名]，邮箱保留（半结构化）
   *
   * 注意：此方法返回清洗后的副本，不修改原字符串。
   * 命中后应发布 SECURITY.DENY 审计事件（由调用方决定）。
   *
   * @param text 待清洗的输出文本
   * @returns [清洗后文本, 检测结果]
   */
  sanitizeOutput(text: string): [string, Record<string, any>] {
    const result = this.detectOutputSensitive(text)
    let sanitized = text

    // 清洗密钥/凭证
    for (const [secretType, pattern] of Object.entries(_SECRET_PATTERNS)) {
      pattern.lastIndex = 0
      sanitized = sanitized.replace(pattern, `[REDACTED:${secretType}]`)
    }

    // 清洗内网 IP
    for (const pattern of _INTERNAL_IP_PATTERNS) {
      pattern.lastIndex = 0
      sanitized = sanitized.replace(pattern, '[REDACTED:INTERNAL_IP]')
    }

    // 清洗 PII（手机号、身份证、银行卡）
    const piiTypesToRedact = ['phone_cn', 'id_card_cn', 'bank_card']
    for (const piiType of piiTypesToRedact) {
      const pattern = _PII_PATTERNS[piiType]
      if (pattern) {
        sanitized = sanitized.replace(pattern, `[REDACTED:${piiType}]`)
      }
    }

    return [sanitized, result]
  }
}
