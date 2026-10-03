// 需求澄清评测测试（阶段3）
//
// 把灰度门禁（误触发率 ≤ 15% ↔ precision ≥ 0.85、recall ≥ 0.6）固化为可执行断言：
//   1. 规则路径在 clarification 数据集上满足门禁
//   2. 明确短指令零误触发（min_input_chars 收窄的回归保护）
//   3. llm-required（语义歧义）样本被标记为规则盲区，可量化复判增量空间
import { describe, it, expect } from 'vitest'
import { CLARIFY_GATE, checkClarifyGate, runClarificationEval } from '../src/clarification-eval.js'

describe('需求澄清评测（阶段3 门禁）', () => {
  it('规则路径满足灰度门禁：precision ≥ 0.85 且 recall ≥ 0.6（仅规则范围）', () => {
    const report = runClarificationEval()
    expect(report.examined).toBeGreaterThanOrEqual(12)
    // 主门禁样本 = 全部标注用例 - llm-required（语义歧义属复判目标，不计入规则 KPI）
    expect(report.ruleScope).toBeGreaterThanOrEqual(9)
    expect(report.precision).not.toBeNull()
    expect(report.precision!).toBeGreaterThanOrEqual(CLARIFY_GATE.minPrecision)
    expect(report.recall).not.toBeNull()
    expect(report.recall!).toBeGreaterThanOrEqual(CLARIFY_GATE.minRecall)
    // 门禁判定应无未达标项
    expect(checkClarifyGate(report)).toEqual([])
  })

  it('明确短指令零误触发（阈值调优回归保护）', () => {
    const report = runClarificationEval()
    const shortCases = report.cases.filter((c) => c.input.length <= 6 && !c.expected)
    expect(shortCases.length).toBeGreaterThanOrEqual(3)
    // 全部明确短指令均未被误判为"需澄清"
    expect(shortCases.every((c) => !c.actual)).toBe(true)
  })

  it('llm-required 样本被显式标记为规则盲区（复判增量空间可量化）', () => {
    const report = runClarificationEval()
    expect(report.llmRequired.total).toBeGreaterThanOrEqual(3)
    // 规则路径无法覆盖全部语义歧义样本
    expect(report.llmRequired.covered).toBeLessThan(report.llmRequired.total)
  })

  it('注入自定义配置可复现不同阈值的评测结果（调参闭环）', () => {
    // 把 min_input_chars 调回 10：明确短指令（3-6 字）会被误触发 → precision 下降
    const strict = runClarificationEval({
      cfg: {
        enabled: true,
        max_clarify_rounds: 2,
        min_input_chars: 10,
        insufficient_patterns: ['帮我弄一下', '帮我搞一下', '随便弄', '你看着办'],
        question_template: '请补充需求',
        default_options: [],
      },
    })
    const relaxed = runClarificationEval()
    expect(strict.precision!).toBeLessThan(relaxed.precision!)
  })
})
