// 对应 Python: components/perception/text/rule_based.py
// 文本预处理器（感知层核心组件）
//
// 优化后能力（对应感知层优化方案 P0）：
// - 文本清洗：控制字符 / 零宽字符 / 方向控制字符过滤
// - 智能截断：句子边界感知 + 截断元数据
// - 鲁棒语种检测：扩展 Unicode 区间 + Emoji 过滤 + 语种分布
// - 细粒度敏感词分级：0-5 级 + 词边界匹配
// - 安全检测：Prompt Injection / PII / 注入风险
// - 真实置信度计算：加权平均
// - 输入质量评估：启发式规则
import { BasePerception } from '../../core/interfaces/perception.js'
import { SecurityGuard } from '../security/guard.js'

// ---------------------------------------------------------------------------
// 敏感词分级模式（对应问题 4：细粒度分级 + 词边界匹配）
// ---------------------------------------------------------------------------

// 敏感度分级定义
// 0: safe          无敏感内容
// 1: notice        含可能敏感词，但上下文安全
// 2: sensitive     含敏感词，需标记
// 3: high_risk     高风险，需降级处理
// 4: review        需人工审核
// 5: block         直接拒绝
const SENSITIVITY_LEVELS: Record<number, string> = {
  0: 'safe',
  1: 'notice',
  2: 'sensitive',
  3: 'high_risk',
  4: 'review',
  5: 'block',
}

// 多层正则分类：级别 → 模式列表
// 注意：Python 3 中 \w 匹配 Unicode 字符（含中文），故中文关键词不使用 \w 边界
// 中文关键词直接匹配（中文无词边界概念），英文关键词使用 \b 边界
const SENSITIVITY_PATTERNS: Record<number, RegExp[]> = {
  5: [ // 直接拒绝级：密码明文泄露
    /\b(?:password|passwd)\s*[=:]\s*\S+/i,
    /(?:密码|口令)\s*[=：:]\s*\S+/,
  ],
  4: [ // 需人工审核级：身份证号明文
    /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/,
  ],
  3: [ // 高风险级：敏感实体词
    /(?:银行卡|身份证)/i,
    /\b(?:passport|credit\s*card)\b/i,
  ],
  2: [ // 敏感级：敏感操作词
    /(?:转账|汇款|支付)/,
    /\b(?:payment|transfer)\b/i,
  ],
  1: [ // 注意级：可能敏感词
    /(?:密码|口令)/,
    /\b(?:password|passwd|secret)\b/i,
  ],
}

// ---------------------------------------------------------------------------
// P1: 上下文关键词规则（降低误伤率）
// ---------------------------------------------------------------------------
// 当敏感词命中时，若同时出现"安全上下文关键词"，则降低敏感级别
// 格式: {敏感词模式, 安全上下文关键词列表, 降级幅度}
const _CONTEXT_SAFE_KEYWORDS: Array<{ pattern: RegExp; keywords: string[]; reduction: number }> = [
  // 银行卡 + 求助场景 → 降 2 级（3 → 1）
  {
    pattern: /(?:银行卡|身份证)/,
    keywords: ['丢了', '被盗', '挂失', '找不到', '丢失', '不见了', '忘带', '过期', '补办'],
    reduction: 2,
  },
  // 密码 + 求助场景 → 降 1 级（1 → 0）
  {
    pattern: /(?:密码|口令)/,
    keywords: ['忘记', '忘了', '重置', '找回', '修改', '重设', 'reset', 'forgot'],
    reduction: 1,
  },
  // 转账 + 询问场景 → 降 1 级（2 → 1）
  {
    pattern: /(?:转账|汇款)/,
    keywords: ['怎么', '如何', '能不能', '可以吗', '需要', '流程', '手续费', '限额'],
    reduction: 1,
  },
]

// P1: 白名单短语（完全跳过敏感检测）
const _WHITELIST_PHRASES: string[] = [
  '密码学',
  '密码算法',
  '加密算法',
  'password policy',
  'password strength',
  'password security',
]

// ---------------------------------------------------------------------------
// 文本清洗常量（对应问题 10：编码与清洗细节）
// ---------------------------------------------------------------------------

// 需过滤的字符类别：控制字符(Cc)、格式字符(Cf)、私有区(Co)、代理区(Cs)
// JS 无 unicodedata.category，用 Unicode 属性转义 \p{Cc} 等近似
const _STRIP_CATEGORIES_REGEX = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u
// 保留的空白控制字符
const _KEEP_CHARS = new Set(['\t', '\n', '\r'])
// 双向控制字符区间（U+202A-U+202E, U+2066-U+2069）
const _BIDI_RANGES: Array<[number, number]> = [[0x202a, 0x202e], [0x2066, 0x2069]]

// ---------------------------------------------------------------------------
// 语言检测 Unicode 区间（对应问题 3：扩展覆盖范围）
// ---------------------------------------------------------------------------

const _LANG_RANGES: Record<string, Array<[number, number]>> = {
  zh: [
    [0x4e00, 0x9fff],  // CJK 统一汉字
    [0x3400, 0x4dbf],  // CJK 扩展 A
    [0x3000, 0x303f],  // CJK 标点
    [0xf900, 0xfaff],  // CJK 兼容汉字
  ],
  ja: [
    [0x3040, 0x309f],  // 平假名
    [0x30a0, 0x30ff],  // 片假名
  ],
  ko: [
    [0xac00, 0xd7af],  // 谚文音节
    [0x1100, 0x11ff],  // 谚文兼容
  ],
  ar: [[0x0600, 0x06ff], [0x0750, 0x077f]],  // 阿拉伯文
  ru: [[0x0400, 0x04ff]],  // 西里尔文
  th: [[0x0e00, 0x0e7f]],  // 泰文
  en: [
    [0x0041, 0x005a],  // 基本拉丁大写
    [0x0061, 0x007a],  // 基本拉丁小写
    [0x00c0, 0x024f],  // 拉丁扩展
  ],
}

// Emoji 区间（粗略过滤，避免干扰语种统计）
const _EMOJI_RANGES: Array<[number, number]> = [
  [0x1f600, 0x1f64f],  // 表情
  [0x1f300, 0x1f5ff],  // 符号
  [0x1f680, 0x1f6ff],  // 交通
  [0x1f900, 0x1f9ff],  // 补充
  [0x2600, 0x26ff],    // 杂项符号
  [0x2700, 0x27bf],    // 装饰符号
]

function _inRanges(cp: number, ranges: Array<[number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true
  }
  return false
}

function _isEmoji(cp: number): boolean {
  return _inRanges(cp, _EMOJI_RANGES)
}

// P1: 检测 langdetect 是否可用（可选依赖，TS 版无等价库）
const _LANGDETECT_AVAILABLE = false

/**
 * 文本预处理器（感知层核心组件）。
 * 对应 Python TextPreprocessor。
 *
 * 优化后能力（对应感知层优化方案 P0）：
 * - 文本清洗：控制字符 / 零宽字符 / 方向控制字符过滤
 * - 智能截断：句子边界感知 + 截断元数据
 * - 鲁棒语种检测：扩展 Unicode 区间 + Emoji 过滤 + 语种分布
 * - 细粒度敏感词分级：0-5 级 + 词边界匹配
 * - 安全检测：Prompt Injection / PII / 注入风险
 * - 真实置信度计算：加权平均
 * - 输入质量评估：启发式规则
 */
export class TextPreprocessor extends BasePerception {
  private _language: string
  private _maxLength: number
  private _securityGuard: SecurityGuard | null
  private _enableQuality: boolean
  private _extraPatterns: RegExp[]

  constructor(
    language: string = 'zh',
    maxLength: number = 2048,
    sensitivityPatterns?: string[] | null,
    enableSecurityGuard: boolean = true,
    enableQualityAssessment: boolean = true,
  ) {
    super()
    this._language = language
    this._maxLength = maxLength
    this._securityGuard = enableSecurityGuard ? new SecurityGuard() : null
    this._enableQuality = enableQualityAssessment

    // 兼容旧参数：若传入 sensitivity_patterns，作为 level=5 的补充模式
    this._extraPatterns = []
    if (sensitivityPatterns) {
      this._extraPatterns = sensitivityPatterns.map((p) => new RegExp(p, 'i'))
    }
  }

  perceive(
    inputType: string,
    rawContent: Uint8Array,
    language?: string | null,
    sensitivityLevel: number = 0,
  ): Record<string, any> {
    if (inputType !== 'text') {
      return {
        parsed_content: { input_type: inputType, error: 'unsupported input type' },
        detected_language: null,
        confidence: 0.0,
        metadata: { sensitivity_level: 0 },
      }
    }

    // 1. 解码 + 智能截断
    const [text, truncationInfo, decodingErrors] = this._decodeAndTruncate(rawContent)

    // 2. 文本清洗（控制字符 / 零宽字符 / 方向控制字符）
    const [sanitizedText, sanitizationWarnings] = this._sanitizeText(text)

    // 3. 语种检测（返回分布）
    const langDist = this._detectLanguageRobust(sanitizedText)
    const detectedLang = language ?? this._pickDominantLanguage(langDist)
    const languageMixed = this._isLanguageMixed(langDist)

    // 4. 敏感词检测（细粒度分级）
    const detectedSensitivity = this._detectSensitivity(sanitizedText)
    const finalSensitivity = Math.max(sensitivityLevel, detectedSensitivity)

    // 5. 安全检测
    let securityResult: Record<string, any> = {}
    let securityScore = 1.0
    if (this._securityGuard) {
      securityResult = this._securityGuard.detectAll(sanitizedText, finalSensitivity)
      securityScore = securityResult.security_score ?? 1.0
    }

    // 6. 输入质量评估
    let qualityScore = 1.0
    if (this._enableQuality) {
      qualityScore = this._assessQuality(sanitizedText, detectedLang)
    }

    // 7. 置信度计算（加权平均）
    const confidence = this._computeConfidence(
      langDist, finalSensitivity, securityScore, qualityScore, decodingErrors,
    )

    const metadata: Record<string, any> = {
      sensitivity_level: finalSensitivity,
      sensitivity_label: SENSITIVITY_LEVELS[finalSensitivity] ?? 'unknown',
      truncated: truncationInfo.truncated ?? false,
      original_length: rawContent.length,
      truncation_info: truncationInfo,
      decoding_errors: decodingErrors,
      sanitization_warnings: sanitizationWarnings,
      security_score: securityScore,
    }
    if (Object.keys(securityResult).length > 0) {
      metadata['injection_detected'] = securityResult.injection_detected ?? false
      metadata['pii_detected'] = securityResult.pii_detected ?? false
      metadata['security_details'] = securityResult
    }

    return {
      parsed_content: {
        input_type: 'text',
        text: sanitizedText,
      },
      detected_language: detectedLang,
      confidence,
      metadata,
      language_distribution: langDist,
      language_mixed: languageMixed,
      quality_score: qualityScore,
      security_score: securityScore,
      intent: null,      // P1：集成 Sentence-BERT 后填充
      entities: [],      // P1：集成 spaCy/HanLP 后填充
      sentiment: null,   // P1：集成 SnowNLP 后填充
    }
  }

  // ------------------------------------------------------------------
  // 解码 + 智能截断（对应问题 6）
  // ------------------------------------------------------------------

  /**
   * 解码 + 智能截断。
   * 对应 Python _decode_and_truncate。
   *
   * @returns [text, truncationInfo, decodingErrors]
   */
  private _decodeAndTruncate(rawContent: Uint8Array): [string, Record<string, any>, number] {
    let decodingErrors = 0
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let text = decoder.decode(rawContent)
    // 检测替换字符数量
    decodingErrors = (text.match(/\uFFFD/g) ?? []).length

    // NFKC 归一化（对应 Python unicodedata.normalize("NFKC", text)）
    text = text.normalize('NFKC')
    text = text.trim()

    const truncationInfo = this._truncateSmart(text, this._maxLength)
    if (truncationInfo.truncated) {
      text = text.slice(0, truncationInfo.truncated_length)
    }

    return [text, truncationInfo, decodingErrors]
  }

  /** 智能截断：在句子边界截断，避免语义断裂。 */
  private _truncateSmart(text: string, maxLength: number): Record<string, any> {
    const originalLength = text.length
    if (originalLength <= maxLength) {
      return {
        truncated: false,
        original_length: originalLength,
        truncated_length: originalLength,
        truncation_ratio: 1.0,
        method: 'none',
      }
    }

    // P1: JSON 感知截断
    const stripped = text.replace(/^\s+/, '')
    if (stripped.length > 0 && (stripped[0] === '{' || stripped[0] === '[')) {
      const jsonResult = this._truncateJson(text, maxLength)
      if (jsonResult !== null) {
        return jsonResult
      }
    }

    // 在 maxLength 附近寻找最近的句子边界
    const truncatedPrefix = text.slice(0, maxLength)
    const sentenceBoundaries = ['。', '！', '？', '. ', '! ', '? ', '\n', '\r\n', '；', '; ']

    let bestPos = maxLength
    for (const boundary of sentenceBoundaries) {
      const pos = truncatedPrefix.lastIndexOf(boundary)
      if (pos > maxLength * 0.8) {  // 至少保留 80%
        const candidate = pos + boundary.length
        if (candidate < bestPos) {
          bestPos = candidate
        }
      }
    }

    const truncatedLength = bestPos
    return {
      truncated: true,
      original_length: originalLength,
      truncated_length: truncatedLength,
      truncation_ratio: Math.round((truncatedLength / originalLength) * 100) / 100,
      method: 'sentence_boundary',
    }
  }

  /** JSON 感知截断。 */
  private _truncateJson(text: string, maxLength: number): Record<string, any> | null {
    const originalLength = text.length
    const stripped = text.replace(/^\s+/, '')
    const leadingWs = text.length - stripped.length
    const isArray = stripped[0] === '['

    // 尝试完整解析
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }

    if (parsed !== null) {
      // 完整 JSON，但长度超限：逐个移除末尾元素
      if (typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null) {
        const items = Object.entries(parsed)
        while (items.length > 0) {
          const truncatedDict = Object.fromEntries(items)
          const candidate = JSON.stringify(truncatedDict)
          if (candidate.length <= maxLength) {
            return {
              truncated: true,
              original_length: originalLength,
              truncated_length: candidate.length,
              truncation_ratio: Math.round((candidate.length / originalLength) * 100) / 100,
              method: 'json_key_boundary',
              removed_keys: Object.keys(parsed).length - items.length,
            }
          }
          items.pop()
        }
        return null
      }

      if (Array.isArray(parsed)) {
        const items = [...parsed]
        while (items.length > 0) {
          const candidate = JSON.stringify(items)
          if (candidate.length <= maxLength) {
            return {
              truncated: true,
              original_length: originalLength,
              truncated_length: candidate.length,
              truncation_ratio: Math.round((candidate.length / originalLength) * 100) / 100,
              method: 'json_array_boundary',
              removed_items: parsed.length - items.length,
            }
          }
          items.pop()
        }
        return null
      }

      return null
    }

    // 截断的 JSON：找最后一个完整 key-value / array element
    const searchEnd = Math.min(maxLength, text.length)
    // Python: text.rfind(',', leadingWs, searchEnd) — JS lastIndexOf 仅接受 1-2 参数
    const lastComma = text.lastIndexOf(',', searchEnd - 1)
    if (lastComma <= leadingWs) {
      return null
    }

    // 截断到逗号位置，补全闭合括号
    let truncated = text.slice(0, lastComma)
    truncated = truncated.replace(/\s+$/, '')
    truncated = this._fixIncompleteJsonTail(truncated)

    const closeChar = isArray ? ']' : '}'
    truncated = truncated + closeChar

    if (truncated.length > maxLength) {
      return null
    }

    return {
      truncated: true,
      original_length: originalLength,
      truncated_length: truncated.length,
      truncation_ratio: Math.round((truncated.length / originalLength) * 100) / 100,
      method: 'json_repair',
      repaired: true,
    }
  }

  /** 修复 JSON 尾部不完整的 token。 */
  private _fixIncompleteJsonTail(text: string): string {
    const lastQuote = text.lastIndexOf('"')
    if (lastQuote === -1) {
      return text
    }

    // 统计引号数量，奇数表示字符串未闭合
    const quoteCount = (text.match(/"/g) ?? []).length
    if (quoteCount % 2 === 0) {
      return text
    }

    // 找到未闭合字符串的起始引号
    const prevQuote = text.lastIndexOf('"', lastQuote - 1)
    if (prevQuote === -1) {
      return text
    }

    // 判断是 key 还是 value
    const colonPos = text.lastIndexOf(':', lastQuote)

    if (colonPos === -1 || colonPos < prevQuote) {
      // 未闭合的是 key：移除整个 key-value 对
      const commaPos = text.lastIndexOf(',', prevQuote)
      if (commaPos !== -1) {
        return text.slice(0, commaPos).replace(/\s+$/, '')
      }
      return text.slice(0, prevQuote).replace(/\s+$/, '')
    } else {
      // 未闭合的是 value：截断到 value 起始引号并闭合
      return text.slice(0, lastQuote + 1)
    }
  }

  // ------------------------------------------------------------------
  // 文本清洗（对应问题 10）
  // ------------------------------------------------------------------

  /** 清洗文本中的控制字符、零宽字符、方向控制字符。 */
  private _sanitizeText(text: string): [string, Record<string, any>] {
    const sanitized: string[] = []
    const warnings: Record<string, any> = {
      stripped_control_chars: 0,
      stripped_zero_width: 0,
      stripped_bidi_chars: 0,
      compressed_repeats: 0,
      excessive_uppercase: false,
    }

    // 第一遍：过滤控制字符 / 零宽字符 / 方向控制字符
    for (const char of text) {
      const cp = char.codePointAt(0)!

      // 保留的空白控制字符
      if (_KEEP_CHARS.has(char)) {
        sanitized.push(char)
        continue
      }

      // 过滤控制字符/格式字符（使用 Unicode 属性近似判断）
      if (_STRIP_CATEGORIES_REGEX.test(char)) {
        // Cf 类别（格式字符，含零宽）
        if (/\p{Cf}/u.test(char)) {
          warnings.stripped_zero_width += 1
        } else {
          warnings.stripped_control_chars += 1
        }
        continue
      }

      // 过滤双向控制字符
      if (_inRanges(cp, _BIDI_RANGES)) {
        warnings.stripped_bidi_chars += 1
        continue
      }

      sanitized.push(char)
    }

    let cleaned = sanitized.join('')

    // 第二遍：重复字符压缩
    const [compressed, repeatCount] = this._compressRepeats(cleaned)
    cleaned = compressed
    warnings.compressed_repeats = repeatCount

    // 第三遍：过度大写检测
    warnings.excessive_uppercase = this._detectExcessiveUppercase(cleaned)

    return [cleaned, warnings]
  }

  /** 压缩连续重复字符。 */
  private _compressRepeats(text: string, threshold: number = 5, maxKeep: number = 3): [string, number] {
    if (text.length <= threshold) {
      return [text, 0]
    }

    const result: string[] = []
    let compressedCount = 0
    let i = 0
    const length = text.length

    while (i < length) {
      const char = text[i]
      // 不压缩空白字符
      if (_KEEP_CHARS.has(char) || /\s/.test(char)) {
        result.push(char)
        i += 1
        continue
      }

      // 统计连续重复次数
      let runEnd = i + 1
      while (runEnd < length && text[runEnd] === char) {
        runEnd += 1
      }
      const runLength = runEnd - i

      if (runLength > threshold) {
        result.push(char.repeat(maxKeep))
        compressedCount += runLength - maxKeep
      } else {
        result.push(char.repeat(runLength))
      }

      i = runEnd
    }

    return [result.join(''), compressedCount]
  }

  /** 检测过度大写（大写字母占比 > threshold）。 */
  private _detectExcessiveUppercase(text: string, threshold: number = 0.7): boolean {
    let upperCount = 0
    let letterCount = 0
    for (const char of text) {
      if (char >= 'a' && char <= 'z') {
        letterCount += 1
      } else if (char >= 'A' && char <= 'Z') {
        letterCount += 1
        upperCount += 1
      }
    }

    if (letterCount < 10) {
      return false
    }

    return (upperCount / letterCount) > threshold
  }

  // ------------------------------------------------------------------
  // 鲁棒语种检测（对应问题 3）
  // ------------------------------------------------------------------

  /** 扩展 Unicode 区间 + Emoji 过滤，返回语种概率分布。 */
  private _detectLanguageRobust(text: string): Record<string, number> {
    // 基线：Unicode 区间计数
    const counts: Record<string, number> = {}
    for (const lang of Object.keys(_LANG_RANGES)) {
      counts[lang] = 0
    }
    let total = 0

    for (const char of text) {
      const cp = char.codePointAt(0)!
      if (_isEmoji(cp)) {
        continue
      }
      for (const [lang, ranges] of Object.entries(_LANG_RANGES)) {
        if (_inRanges(cp, ranges)) {
          counts[lang] += 1
          total += 1
          break
        }
      }
    }

    if (total === 0) {
      return { [this._language]: 1.0 }
    }

    // 归一化为概率分布
    const distribution: Record<string, number> = {}
    for (const [lang, count] of Object.entries(counts)) {
      if (count > 0) {
        distribution[lang] = Math.round((count / total) * 1000) / 1000
      }
    }

    // P1: langdetect 修正（仅对足够长的文本启用）
    // TS 版无 langdetect 等价库，跳过此步骤
    if (_LANGDETECT_AVAILABLE && text.length >= 20) {
      // TODO: 集成 JS 语种检测库后填充
    }

    return distribution
  }

  /** 从语种分布中选取主导语种。 */
  private _pickDominantLanguage(distribution: Record<string, number>): string {
    const keys = Object.keys(distribution)
    if (keys.length === 0) {
      return this._language
    }
    let bestLang = keys[0]
    let bestProb = distribution[bestLang]
    for (const lang of keys) {
      if (distribution[lang] > bestProb) {
        bestLang = lang
        bestProb = distribution[lang]
      }
    }
    return bestLang
  }

  /** 判断是否存在语种混淆（次高语种占比 > 0.3）。 */
  private _isLanguageMixed(distribution: Record<string, number>): boolean {
    const values = Object.values(distribution).sort((a, b) => b - a)
    if (values.length < 2) {
      return false
    }
    return values[1] > 0.3
  }

  // ------------------------------------------------------------------
  // 细粒度敏感词检测（对应问题 4）
  // ------------------------------------------------------------------

  /** 多层正则分类检测，返回最高命中的敏感级别（0-5）。 */
  private _detectSensitivity(text: string): number {
    // P1: 白名单短语优先匹配
    const textLower = text.toLowerCase()
    for (const phrase of _WHITELIST_PHRASES) {
      if (textLower.includes(phrase.toLowerCase())) {
        return 0
      }
    }

    let maxLevel = 0
    const levels = Object.keys(SENSITIVITY_PATTERNS).map(Number).sort((a, b) => b - a)
    for (const level of levels) {
      for (const pattern of SENSITIVITY_PATTERNS[level]) {
        if (pattern.test(text)) {
          maxLevel = Math.max(maxLevel, level)
          break
        }
      }
      if (maxLevel >= 5) {
        break
      }
    }

    // 兼容旧参数的补充模式（默认归为 level=5）
    for (const pattern of this._extraPatterns) {
      if (pattern.test(text)) {
        maxLevel = Math.max(maxLevel, 5)
        break
      }
    }

    // P1: 上下文关键词降级（仅对 level >= 2 的命中生效）
    if (maxLevel >= 2) {
      maxLevel = this._applyContextReduction(text, maxLevel)
    }

    return maxLevel
  }

  /** 根据上下文关键词降低敏感级别。 */
  private _applyContextReduction(text: string, currentLevel: number): number {
    let reducedLevel = currentLevel
    const textLower = text.toLowerCase()
    for (const { pattern, keywords, reduction } of _CONTEXT_SAFE_KEYWORDS) {
      if (pattern.test(text)) {
        for (const keyword of keywords) {
          if (textLower.includes(keyword.toLowerCase())) {
            reducedLevel = Math.min(reducedLevel, currentLevel - reduction)
            break
          }
        }
      }
    }
    return Math.max(0, reducedLevel)
  }

  // ------------------------------------------------------------------
  // 输入质量评估（对应问题 2）
  // ------------------------------------------------------------------

  /** 启发式规则评估输入质量（0~1）。 */
  private _assessQuality(text: string, _language: string): number {
    if (!text) {
      return 0.0
    }

    let score = 1.0
    const length = text.length

    // 长度适宜度
    if (length < 5) {
      score -= 0.3
    } else if (length < 10) {
      score -= 0.15
    } else if (length > this._maxLength * 0.9) {
      score -= 0.1
    }

    // 有效词占比
    let nonSpace = 0
    for (const c of text) {
      if (!/\s/.test(c)) nonSpace += 1
    }
    const validRatio = length > 0 ? nonSpace / length : 0
    if (validRatio < 0.5) {
      score -= 0.2
    }

    // 信息密度（疑问词 / 关键词）
    const questionMarks = (text.match(/\?/g) ?? []).length + (text.match(/？/g) ?? []).length
    if (questionMarks === 0 && length > 20) {
      score -= 0.05
    }

    // 重复度检测
    const maxRepeat = this._maxConsecutiveRepeat(text)
    if (maxRepeat > 5) {
      score -= 0.2 * Math.min((maxRepeat - 5) / 10, 1.0)
    }

    return Math.max(0.0, Math.min(1.0, Math.round(score * 1000) / 1000))
  }

  /** 计算最大连续重复字符数。 */
  private _maxConsecutiveRepeat(text: string): number {
    if (!text) {
      return 0
    }
    let maxRepeat = 1
    let current = 1
    for (let i = 1; i < text.length; i++) {
      if (text[i] === text[i - 1]) {
        current += 1
        maxRepeat = Math.max(maxRepeat, current)
      } else {
        current = 1
      }
    }
    return maxRepeat
  }

  // ------------------------------------------------------------------
  // 置信度计算（对应问题 2：真实置信度）
  // ------------------------------------------------------------------

  /** 综合计算置信度（0~1）。 */
  private _computeConfidence(
    langDist: Record<string, number>,
    sensitivityLevel: number,
    securityScore: number,
    qualityScore: number,
    decodingErrors: number,
  ): number {
    // 语种检测置信度
    const langValues = Object.values(langDist)
    const langConf = langValues.length > 0 ? Math.max(...langValues) : 0.5

    // 敏感词级别影响
    const sensitivityFactor = 1.0 - (sensitivityLevel / 5.0) * 0.5

    // 解码错误影响
    const decodingFactor = Math.max(0.0, 1.0 - decodingErrors * 0.1)

    const confidence =
      langConf * 0.25 +
      securityScore * 0.30 +
      qualityScore * 0.25 +
      sensitivityFactor * 0.10 +
      decodingFactor * 0.10

    return Math.max(0.0, Math.min(1.0, Math.round(confidence * 1000) / 1000))
  }
}
