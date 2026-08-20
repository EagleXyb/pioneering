// config-loader 测试：YAML 加载 / env 插值 / 校验 / 点分键转换
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dottedToObject,
  interpolateEnv,
  loadGlobalConfig,
  loadThresholds,
  loadYaml,
} from '../src/config-loader.js'

describe('interpolateEnv', () => {
  it('展开已设置的环境变量', () => {
    process.env['EVALS_TEST_VAR'] = 'hello'
    expect(interpolateEnv('${EVALS_TEST_VAR}')).toBe('hello')
    delete process.env['EVALS_TEST_VAR']
  })

  it('未设置时使用默认值', () => {
    expect(interpolateEnv('${EVALS_TEST_ABSENT:deepseek}')).toBe('deepseek')
  })

  it('未设置且无默认值时替换为空串', () => {
    expect(interpolateEnv('${EVALS_TEST_ABSENT}')).toBe('')
  })

  it('混合文本中仅替换变量部分', () => {
    process.env['EVALS_TEST_VAR'] = 'glm'
    expect(interpolateEvalMixed()).toBe('provider=glm,mode=hybrid')
    delete process.env['EVALS_TEST_VAR']
  })

  function interpolateEvalMixed(): string {
    return interpolateEnv('provider=${EVALS_TEST_VAR},mode=${EVALS_TEST_ABSENT:hybrid}')
  }
})

describe('dottedToObject', () => {
  it('点分键转嵌套对象', () => {
    expect(dottedToObject({ 'llm.temperature': 0.3, 'a.b.c': 1 })).toEqual({
      llm: { temperature: 0.3 },
      a: { b: { c: 1 } },
    })
  })
})

describe('loadYaml + loadGlobalConfig', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'evals-cfg-'))
  const cfgPath = join(tmp, 'global.yaml')

  it('加载 YAML 并做深度 env 插值', () => {
    process.env['EVALS_TEST_PROVIDER'] = 'glm'
    writeFileSync(
      cfgPath,
      [
        'version: 1',
        'runner:',
        '  concurrency: 8',
        'judge:',
        '  mode: hybrid',
        "  provider: ${EVALS_TEST_PROVIDER:deepseek}",
        'agent_overrides:',
        '  llm.temperature: 0.1',
      ].join('\n'),
      'utf-8',
    )
    const cfg = loadGlobalConfig(cfgPath)
    expect(cfg.runner?.concurrency).toBe(8)
    expect(cfg.judge?.provider).toBe('glm')
    expect(cfg.agent_overrides?.['llm.temperature']).toBe(0.1)
    // 未配置的字段落默认值
    expect(cfg.report?.baseline).toBe('latest')
    delete process.env['EVALS_TEST_PROVIDER']
  })

  it('文件不存在时抛错', () => {
    expect(() => loadYaml(join(tmp, 'nope.yaml'))).toThrow(/不存在/)
  })

  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
})

describe('loadThresholds（真实 thresholds.yaml）', () => {
  it('指标定义齐全且 higher_is_better 有默认值', () => {
    const thresholds = loadThresholds()
    expect(thresholds.metrics['output_relevance']).toMatchObject({
      category: 'output',
      gate: 'block',
      threshold: 0.6,
    })
    expect(thresholds.metrics['process_redundant_calls'].higherIsBetter).toBe(false)
    expect(Object.keys(thresholds.metrics).length).toBeGreaterThanOrEqual(10)
  })

  it('gate 取值非法时抛错', () => {
    const bad = mkdtempSync(join(tmpdir(), 'evals-bad-'))
    const p = join(bad, 't.yaml')
    writeFileSync(p, 'version: 1\nmetrics:\n  x:\n    category: output\n    weight: 1\n    threshold: 1\n    gate: boom\n', 'utf-8')
    expect(() => loadThresholds(p)).toThrow(/gate/)
    rmSync(bad, { recursive: true, force: true })
  })
})
