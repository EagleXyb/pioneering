import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  parseMarkdownDoc,
  parseFrontmatter,
  loadMarkdownDocs,
  findConventionalMarkdownDocs,
  loadDomainAdaptersFromMarkdown,
  getPackageRoot,
} from '@/config/markdown-loader.js'
import { MarkdownPromptAggregator } from '@/config/markdown-prompt-aggregator.js'
import { RuntimeConfig } from '@/config/runtime-config.js'
import { _getSystemPrompt } from '@/graph/subgraph/builder.js'
import {
  registerDomainsFromMarkdown,
  getDomainAdapter,
  DOMAIN_ADAPTERS,
} from '@/reasoning/domain-adapters.js'

// ============================================================
// P1（文档 4.4-P1）落地的系统化测试
// 目标：验证 markdown-loader / aggregator / factory 注入 /
//       子 Agent 模板外置 / 领域适配加载 均不破坏原有业务逻辑
// ============================================================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p1-md-'))
}

function rmrf(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

const tmpDirs: string[] = []
function trackTmp(dir: string): string {
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  while (tmpDirs.length) rmrf(tmpDirs.pop()!)
  // 清理领域注册表，避免测试间相互污染
  for (const k of Object.keys(DOMAIN_ADAPTERS)) delete DOMAIN_ADAPTERS[k]
})

describe('P1: markdown-loader 解析', () => {
  it('无 frontmatter 时整篇视为正文', () => {
    const doc = parseMarkdownDoc('Hello agent rules.\nSecond line.\n', 'AGENTS', '/x/AGENTS.md')
    expect(doc).not.toBeNull()
    expect(doc!.name).toBe('AGENTS')
    expect(doc!.content).toBe('Hello agent rules.\nSecond line.')
    expect(doc!.injectTo).toBe('system_prompt') // 按约定推断
  })

  it('解析 YAML frontmatter 与正文', () => {
    const text = `---
inject_to: system_prompt
priority: 5
---
# 规则
请严格遵守。
`
    const doc = parseMarkdownDoc(text, 'SOUL', '/x/SOUL.md')
    expect(doc).not.toBeNull()
    expect(doc!.meta.inject_to).toBe('system_prompt')
    expect(doc!.meta.priority).toBe(5)
    expect(doc!.content).toContain('请严格遵守')
  })

  it('USER.md 默认注入 runtime_context', () => {
    const doc = parseMarkdownDoc('用户偏好：中文。', 'USER', '/x/USER.md')
    expect(doc!.injectTo).toBe('runtime_context')
  })

  it('空正文返回 null', () => {
    expect(parseMarkdownDoc('   \n  ', 'AGENTS', '/x')).toBeNull()
  })

  it('parseFrontmatter 解析失败返回空对象（不抛异常）', () => {
    expect(parseFrontmatter('not valid yaml line')).toEqual({})
    expect(parseFrontmatter('')).toEqual({})
  })

  it('frontmatter 中无结构化字段时正文作为 domain_context 兜底', () => {
    const doc = parseMarkdownDoc('---\nrole: x\n---\n你是一名金融助手。', 'FIN', '/x/FIN.md')
    expect(doc).not.toBeNull()
  })
})

describe('P1: loadMarkdownDocs 扫描', () => {
  it('无任何 .md 时返回空数组（不抛异常）', () => {
    const dir = trackTmp(makeTmpDir())
    expect(loadMarkdownDocs({ rootDir: dir })).toEqual([])
    expect(findConventionalMarkdownDocs(dir)).toEqual([])
  })

  it('扫描到约定的 AGENTS.md / USER.md', () => {
    const dir = trackTmp(makeTmpDir())
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '---\ninject_to: system_prompt\n---\n行为准则')
    fs.writeFileSync(path.join(dir, 'USER.md'), '---\ninject_to: runtime_context\n---\n用户画像')
    fs.writeFileSync(path.join(dir, 'README.md'), '忽略我') // 非约定文档不扫描
    const docs = loadMarkdownDocs({ rootDir: dir })
    const names = docs.map((d) => d.name).sort()
    expect(names).toEqual(['AGENTS', 'USER'])
    const agents = docs.find((d) => d.name === 'AGENTS')
    expect(agents!.injectTo).toBe('system_prompt')
    const user = docs.find((d) => d.name === 'USER')
    expect(user!.injectTo).toBe('runtime_context')
  })

  it('onlyLoad=lazy 时跳过 eager 文档', () => {
    const dir = trackTmp(makeTmpDir())
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '---\nload: eager\n---\n行为准则')
    fs.writeFileSync(path.join(dir, 'USER.md'), '---\nload: lazy\n---\n用户画像')
    const docs = loadMarkdownDocs({ rootDir: dir, onlyLoad: 'lazy' })
    expect(docs.map((d) => d.name)).toEqual(['USER'])
  })
})

describe('P1: MarkdownPromptAggregator 聚合', () => {
  const base = 'base prompt'

  it('无文档时返回 base 原样（行为等价现状）', () => {
    expect(MarkdownPromptAggregator.aggregateToSystemPrompt(base, [])).toBe(base)
    expect(MarkdownPromptAggregator.collectRuntimeContext([])).toBe('')
  })

  it('system_prompt 类文档聚合进 system prompt', () => {
    const agents = parseMarkdownDoc('行为准则A', 'AGENTS', '/x/AGENTS.md')!
    const soul = parseMarkdownDoc('人格B', 'SOUL', '/x/SOUL.md')!
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt(base, [agents, soul])
    expect(merged).toContain('base prompt')
    expect(merged).toContain('行为准则A')
    expect(merged).toContain('人格B')
  })

  it('runtime_context 类文档收集到 runtimeContext，不进 system prompt', () => {
    const user = parseMarkdownDoc('用户画像', 'USER', '/x/USER.md')!
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt(base, [user])
    expect(merged).toBe(base) // 不受影响
    expect(MarkdownPromptAggregator.collectRuntimeContext([user])).toBe('用户画像')
  })

  it('按 priority 排序（大者在前）', () => {
    const low = parseMarkdownDoc('---\npriority: 1\n---\n低优先级', 'AGENTS', '/x/AGENTS.md')!
    const high = parseMarkdownDoc('---\npriority: 9\n---\n高优先级', 'SOUL', '/x/SOUL.md')!
    const merged = MarkdownPromptAggregator.aggregateToSystemPrompt('', [low, high])
    expect(merged!.indexOf('高优先级')).toBeLessThan(merged!.indexOf('低优先级'))
  })

  it('aggregateFromDocs 返回 systemPrompt 与 runtimeContext', () => {
    const agents = parseMarkdownDoc('行为准则', 'AGENTS', '/x/AGENTS.md')!
    const user = parseMarkdownDoc('用户画像', 'USER', '/x/USER.md')!
    const r = MarkdownPromptAggregator.aggregateFromDocs(base, [agents, user])
    expect(r.systemPrompt).toContain('行为准则')
    expect(r.runtimeContext).toBe('用户画像')
  })
})

describe('P1: 子 Agent 模板外置（_getSystemPrompt）', () => {
  it('customPrompt 优先级最高（原逻辑不变）', () => {
    const cfg = new RuntimeConfig({ agents: { research: { prompt: '配置模板' } } })
    expect(_getSystemPrompt('research', 'custom', cfg)).toBe('custom')
  })

  it('配置 agents.<role>.prompt 覆盖默认模板', () => {
    const cfg = new RuntimeConfig({ agents: { research: { prompt: '研究模板' } } })
    expect(_getSystemPrompt('research', null, cfg)).toBe('研究模板')
  })

  it('无 customPrompt 且无配置时回退硬编码模板（默认行为不变）', () => {
    const cfg = new RuntimeConfig()
    expect(_getSystemPrompt('research', null, cfg)).toContain('Research Agent')
    expect(_getSystemPrompt('default', null, cfg)).toContain('specialized Agent')
  })

  it('不传 config 参数时行为与改造前一致', () => {
    // 兼容旧调用：不传 config 仍返回硬编码模板
    expect(_getSystemPrompt('coding')).toContain('Code Agent')
  })

  it('未知 task_type 回退 default 模板', () => {
    const cfg = new RuntimeConfig({ agents: { foo: { prompt: 'foo模板' } } })
    expect(_getSystemPrompt('unknown_type', null, cfg)).toContain('specialized Agent')
  })
})

describe('P1: 领域适配从 .md 加载', () => {
  it('config/domains 目录不存在时为空操作', () => {
    const dir = trackTmp(makeTmpDir())
    expect(registerDomainsFromMarkdown({ rootDir: dir })).toBe(0)
    expect(Object.keys(DOMAIN_ADAPTERS).length).toBe(0)
  })

  it('从 config/domains/<domain>.md 注册领域适配器', () => {
    const dir = trackTmp(makeTmpDir())
    const domainsDir = path.join(dir, 'config', 'domains')
    fs.mkdirSync(domainsDir, { recursive: true })
    fs.writeFileSync(
      path.join(domainsDir, 'financial_analysis.md'),
      `---
domain_context: 你是金融分析领域的专业Agent
terminology:
  ROE: 净资产收益率
reasoning_patterns:
  - 先看营收增速
output_requirements: 数值保留2位小数
---
（正文可选，优先级低于 frontmatter）
`,
    )
    const n = registerDomainsFromMarkdown({ rootDir: dir })
    expect(n).toBe(1)
    const adapter = getDomainAdapter('financial_analysis')
    expect(adapter).not.toBeNull()
    expect(adapter!.domain_context).toBe('你是金融分析领域的专业Agent')
    expect(adapter!.terminology!['ROE']).toBe('净资产收益率')
    expect(adapter!.reasoning_patterns).toEqual(['先看营收增速'])
    expect(adapter!.output_requirements).toBe('数值保留2位小数')
  })

  it('直接加载接口 loadDomainAdaptersFromMarkdown 返回原始数据', () => {
    const dir = trackTmp(makeTmpDir())
    const domainsDir = path.join(dir, 'config', 'domains')
    fs.mkdirSync(domainsDir, { recursive: true })
    fs.writeFileSync(
      path.join(domainsDir, 'law.md'),
      '---\ndomain_context: 法律领域助手\n---\n（正文兜底内容）\n',
    )
    const items = loadDomainAdaptersFromMarkdown({ rootDir: dir })
    expect(items).toHaveLength(1)
    expect(items[0].domain).toBe('law')
    // frontmatter 的 domain_context 优先于正文
    expect(items[0].adapter.domain_context).toBe('法律领域助手')
  })
})

describe('P1: getPackageRoot 与无 .md 时零侵入', () => {
  it('getPackageRoot 返回可解析的绝对路径', () => {
    const root = getPackageRoot()
    expect(path.isAbsolute(root)).toBe(true)
    expect(fs.existsSync(root)).toBe(true)
  })

  it('无约定 .md 目录时 loadMarkdownDocs 返回空（零侵入）', () => {
    // 用临时空目录验证，避免依赖项目根是否已生成模板文件
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-empty-'))
    try {
      const docs = loadMarkdownDocs({ rootDir: dir })
      expect(docs).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
