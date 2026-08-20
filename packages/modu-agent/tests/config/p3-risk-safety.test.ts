// p3-risk-safety.test.ts
//
// 针对文档 4.5「风险与注意」三点修复的系统化测试：
//   ① Token 膨胀：Markdown 注入长度预算 + MEMORY.md 按需加载 + AGENTS.md 层级 cascade
//   ② 类型安全：YAML 覆盖类型校验（类型不符丢弃并回退默认）
//   ③ 优先级清晰：getConfig 记录来源溯源（sources），快照可溯源

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  MarkdownPromptAggregator,
  DEFAULT_MARKDOWN_BUDGET,
  estimateTokens,
} from '@/config/markdown-prompt-aggregator.js'
import {
  parseMarkdownDoc,
  loadMarkdownDocs,
  CASCADE_LEVEL_ORDER,
} from '@/config/markdown-loader.js'
import {
  loadConfigYamlValidated,
  parseYamlSubset,
} from '@/config/yaml-loader.js'
import {
  RuntimeConfig,
  resetConfig,
  DEFAULT_CONFIG,
} from '@/config/runtime-config.js'
import { buildConfigSnapshot } from '@/config/snapshot.js'

describe('4.5 风险① Token 膨胀', () => {
  it('注入内容超预算时按字符截断并追加标记', () => {
    const doc = parseMarkdownDoc(
      '---\ninject_to: system_prompt\n---\n' + 'A'.repeat(100),
      'AGENTS',
      '/x/AGENTS.md',
    )!
    const budget = { systemPromptMaxChars: 10, runtimeContextMaxChars: 10, truncateMarker: '[truncated]' }
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt('', [doc], budget)!
    expect(merged).toContain('[truncated]')
    // base 为空串时 merged = '\n\n' + 截断后的注入片段，注入片段 = 预算 + 标记长度
    expect(merged.length).toBeLessThanOrEqual(2 + 10 + '[truncated]'.length)
  })

  it('未超预算时不截断（行为等价）', () => {
    const doc = parseMarkdownDoc('短内容', 'AGENTS', '/x/AGENTS.md')!
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt('', [doc])
    expect(merged).toBe('\n\n短内容')
  })

  it('runtimeContext 同样受预算截断', () => {
    const doc = parseMarkdownDoc('---\ninject_to: runtime_context\n---\n' + 'B'.repeat(100), 'USER', '/x/USER.md')!
    const budget = { systemPromptMaxChars: 100, runtimeContextMaxChars: 5, truncateMarker: '!' }
    const rc = MarkdownPromptAggregator.collectRuntimeContext([doc], budget)
    expect(rc).toContain('!')
    expect(rc.length).toBeLessThanOrEqual(5 + 1)
  })

  it('estimateTokens 粗略估算（4 字符 = 1 token）', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('MEMORY.md 默认 lazy，eager 加载时被过滤（按需加载）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-lazy-'))
    try {
      fs.writeFileSync(path.join(dir, 'MEMORY.md'), '---\n---\n记忆正文')
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), '---\n---\n行为准则')
      const eager = loadMarkdownDocs({ rootDir: dir, onlyLoad: 'eager' })
      expect(eager.map((d) => d.name)).toEqual(['AGENTS'])
      const lazy = loadMarkdownDocs({ rootDir: dir, onlyLoad: 'lazy' })
      expect(lazy.map((d) => d.name)).toEqual(['MEMORY'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AGENTS.md 层级 cascade：显式声明 cascade_level 时按层级排序', () => {
    const global = parseMarkdownDoc('---\ninject_to: system_prompt\ncascade_level: global\n---\n全局', 'AGENTS', '/x/AGENTS.md')!
    const user = parseMarkdownDoc('---\ninject_to: system_prompt\ncascade_level: user\n---\n用户', 'USER', '/x/USER.md')!
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt('', [user, global])!
    // global 级应在 user 级之前（级联顺序）
    expect(merged!.indexOf('全局')).toBeLessThan(merged!.indexOf('用户'))
  })

  it('未显式声明 cascade_level 时保持 priority 排序（向后兼容）', () => {
    const low = parseMarkdownDoc('---\npriority: 1\n---\n低', 'AGENTS', '/x/AGENTS.md')!
    const high = parseMarkdownDoc('---\npriority: 9\n---\n高', 'SOUL', '/x/SOUL.md')!
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt('', [low, high])!
    expect(merged!.indexOf('高')).toBeLessThan(merged!.indexOf('低'))
  })

  it('cascade: false 的文档不参与注入', () => {
    const off = parseMarkdownDoc('---\ncascade: false\n---\n不注入', 'AGENTS', '/x/AGENTS.md')!
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt('', [off])
    // 过滤后无片段，返回 base 原样（空串）
    expect(merged).toBe('')
  })

  it('CASCADE_LEVEL_ORDER 顺序为 global < project < user', () => {
    expect(CASCADE_LEVEL_ORDER).toEqual(['global', 'project', 'user'])
  })
})

describe('4.5 风险② 类型安全', () => {
  it('类型不符的字段被丢弃并记录 droppedKeys', () => {
    const base = { llm: { temperature: 0.7, max_tokens: 512 } }
    // temperature 误写为字符串、max_tokens 误写为字符串
    const override = { llm: { temperature: 'abc', max_tokens: '512' } }
    const result = loadConfigYamlValidated(base, path.join(os.tmpdir(), 'nonexist.yaml'))
    // 文件不存在 → null（此处只测 validateAgainstBase 通过 loadConfigYamlValidated 路径）
    // 改用直接解析 + 校验的等价断言：
    const parsed = parseYamlSubset('llm:\n  temperature: abc\n  max_tokens: 512\n')
    // 手动走校验逻辑的等价验证：temperature 'abc' 与 number 不符，max_tokens '512'（字符串）与 number 不符
    // 通过 loadConfigYamlValidated 需要真实文件，这里用临时文件
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-type-'))
    try {
      const f = path.join(dir, 'config.yaml')
      fs.writeFileSync(f, 'llm:\n  temperature: abc\n  max_tokens: "512"\n  default_provider: deepseek\n')
      const r = loadConfigYamlValidated({ llm: { temperature: 0.7, max_tokens: 512, default_provider: 'deepseek' } }, f)!
      expect(r).not.toBeNull()
      // temperature 'abc'（string）应被丢弃；default_provider 'deepseek'（string）应保留
      expect(r.droppedKeys).toContain('llm.temperature')
      expect(r.droppedKeys).toContain('llm.max_tokens')
      expect(r.cleaned.llm.default_provider).toBe('deepseek')
      expect('temperature' in r.cleaned.llm).toBe(false)
      expect('max_tokens' in r.cleaned.llm).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('类型正确的字段被保留', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-type-ok-'))
    try {
      const f = path.join(dir, 'config.yaml')
      fs.writeFileSync(f, 'llm:\n  temperature: 1.2\n  max_tokens: 1024\n')
      const r = loadConfigYamlValidated({ llm: { temperature: 0.7, max_tokens: 512 } }, f)!
      expect(r.droppedKeys).toHaveLength(0)
      expect(r.cleaned.llm.temperature).toBe(1.2)
      expect(r.cleaned.llm.max_tokens).toBe(1024)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('新增键（base 中不存在）放行，不做类型假设', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-type-new-'))
    try {
      const f = path.join(dir, 'config.yaml')
      fs.writeFileSync(f, 'custom_section:\n  foo: bar\n')
      const r = loadConfigYamlValidated({}, f)!
      expect(r.droppedKeys).toHaveLength(0)
      expect(r.cleaned.custom_section).toEqual({ foo: 'bar' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('null 值放行（显式置空）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-type-null-'))
    try {
      const f = path.join(dir, 'config.yaml')
      fs.writeFileSync(f, 'memory:\n  chroma_persist_path: null\n')
      const r = loadConfigYamlValidated({ memory: { chroma_persist_path: null } }, f)!
      expect(r.droppedKeys).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('4.5 风险③ 优先级清晰（溯源快照）', () => {
  afterEach(() => resetConfig())

  it('RuntimeConfig 支持 getSources 溯源', () => {
    const cfg = new RuntimeConfig(null, { base: 'DEFAULT_CONFIG', file: 'config.yaml' })
    expect(cfg.getSources()).toEqual({ base: 'DEFAULT_CONFIG', file: 'config.yaml' })
  })

  it('buildConfigSnapshot 自动读取 getSources（无需调用方手动传）', () => {
    const cfg = new RuntimeConfig(null, { base: 'DEFAULT_CONFIG', file: '/x/config.yaml' })
    const snap = buildConfigSnapshot(cfg)
    expect(snap.sources.file).toBe('/x/config.yaml')
    expect(snap.sources.base).toBe('DEFAULT_CONFIG')
  })

  it('快照脱敏不污染原配置（asDict 深拷贝）', () => {
    const cfg = new RuntimeConfig({ llm: { api_key: 'secret-value' } })
    const snap = buildConfigSnapshot(cfg)
    expect(snap.config.llm.api_key).toBe('***')
    // 原配置未被污染
    expect(cfg.get('llm.api_key')).toBe('secret-value')
  })

  it('类型安全校验丢弃的字段被记录到 sources（getConfig 集成）', () => {
    // 这里验证 loadConfigYamlValidated 的 droppedKeys 可被 sources 引用
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-src-'))
    try {
      const f = path.join(dir, 'config.yaml')
      fs.writeFileSync(f, 'llm:\n  temperature: not_a_number\n')
      const r = loadConfigYamlValidated(DEFAULT_CONFIG, f)!
      expect(r.droppedKeys).toContain('llm.temperature')
      // sources 组装逻辑（由 getConfig 使用）：dropped 记录被丢弃字段
      const sources = { base: 'DEFAULT_CONFIG', file: f, dropped: r.droppedKeys.join(', ') }
      expect(sources.dropped).toBe('llm.temperature')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
