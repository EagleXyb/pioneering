import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { RuntimeConfig } from '@/config/runtime-config.js'
import {
  serializeMemoryToMarkdown,
  parseMemoryFromMarkdown,
  writeMemoryToMarkdownFile,
  readMemoryFromMarkdownFile,
} from '@/config/memory-md-persistence.js'
import { KnowledgeIndex } from '@/config/knowledge-index.js'
import {
  validateManifest,
  parseManifest,
  loadManifestFromFile,
} from '@/config/plugin-manifest.js'
import { buildConfigSnapshot, buildDebugConfigHandler, maskSensitiveValues } from '@/config/snapshot.js'

// ============================================================
// P2（文档 4.4-P2）落地的系统化测试
// 目标：验证 MEMORY.md 持久化 / knowledge-index.json /
//       插件 manifest / 配置溯源快照 均为纯增强、不破坏原有业务逻辑
// ============================================================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p2-'))
}
function rmrf(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}
const tmpDirs: string[] = []
function track(dir: string): string {
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  while (tmpDirs.length) rmrf(tmpDirs.pop()!)
})

describe('P2: MEMORY.md 持久化', () => {
  it('serialize 生成含 frontmatter 与分节的 Markdown', () => {
    const text = serializeMemoryToMarkdown(
      { title: '记忆' },
      [
        { content: '用户偏好中文回复', category: 'preference', timestamp: 1000 },
        { content: '踩坑：先查 datetime', category: 'lesson' },
      ],
    )
    expect(text).toContain('---')
    expect(text).toContain('title: 记忆')
    expect(text).toContain('## 记忆')
    expect(text).toContain('用户偏好中文回复')
    expect(text).toContain('category: preference')
    expect(text).toContain('踩坑：先查 datetime')
  })

  it('parse 能还原序列化内容（round-trip）', () => {
    const original = [
      { content: '用户偏好中文', category: 'preference', timestamp: 123 },
      { content: '经验：善用 search', category: 'lesson' },
    ]
    const text = serializeMemoryToMarkdown({ title: '记忆' }, original)
    const parsed = parseMemoryFromMarkdown(text, '/x/MEMORY.md')
    expect(parsed.meta.title).toBe('记忆')
    expect(parsed.entries.length).toBe(2)
    expect(parsed.entries[0].content).toBe('用户偏好中文')
    expect(parsed.entries[0].category).toBe('preference')
    expect(parsed.entries[0].timestamp).toBe(123)
    expect(parsed.entries[1].content).toBe('经验：善用 search')
    expect(parsed.entries[1].category).toBe('lesson')
  })

  it('无 frontmatter 的简单文本作为单条记忆', () => {
    const parsed = parseMemoryFromMarkdown('今天完成了注册模块', '/x/MEMORY.md')
    expect(parsed.meta).toEqual({})
    expect(parsed.entries.length).toBe(1)
    expect(parsed.entries[0].content).toBe('今天完成了注册模块')
  })

  it('write/read 文件持久化（原子写）', () => {
    const dir = track(makeTmpDir())
    const file = path.join(dir, 'MEMORY.md')
    const ok = writeMemoryToMarkdownFile(file, { title: '长期记忆' }, [
      { content: '记住：使用缓存提升性能', category: 'lesson' },
    ])
    expect(ok).toBe(true)
    const doc = readMemoryFromMarkdownFile(file)
    expect(doc.entries.length).toBe(1)
    expect(doc.entries[0].content).toContain('缓存')
    expect(doc.meta.title).toBe('长期记忆')
  })

  it('读取不存在的文件返回空条目（不抛异常）', () => {
    const doc = readMemoryFromMarkdownFile('/no/such/MEMORY.md')
    expect(doc.entries).toEqual([])
    expect(doc.meta).toEqual({})
  })

  it('写入失败返回 false（不抛异常）', () => {
    // 路径非法（父级为文件）应失败
    const dir = track(makeTmpDir())
    const blocker = path.join(dir, 'blocker')
    fs.writeFileSync(blocker, 'x')
    const bad = writeMemoryToMarkdownFile(path.join(blocker, 'MEMORY.md'), {}, [])
    expect(bad).toBe(false)
  })
})

describe('P2: knowledge-index.json', () => {
  it('add/get/all/remove/size 基本操作', () => {
    const idx = new KnowledgeIndex()
    expect(idx.size()).toBe(0)
    idx.add({ id: 'a', title: '标题A', content: '正文A', tags: ['x'] })
    idx.add({ id: 'b', title: '标题B', content: '正文B', tags: ['y'] })
    expect(idx.size()).toBe(2)
    expect(idx.get('a')!.title).toBe('标题A')
    expect(idx.all().length).toBe(2)
    expect(idx.remove('a')).toBe(true)
    expect(idx.size()).toBe(1)
    expect(idx.get('a')).toBeNull()
  })

  it('search 匹配 title/content/tags/id（大小写不敏感）', () => {
    const idx = new KnowledgeIndex([
      { id: '1', title: '金融分析指南', content: '包含ROE与P/E', tags: ['finance'] },
      { id: '2', title: '天气查询', content: '实时数据', tags: ['weather'] },
    ])
    expect(idx.search('ROE')).toHaveLength(1)
    expect(idx.search('finance')).toHaveLength(1)
    expect(idx.search('天气')).toHaveLength(1)
    expect(idx.search('实时')).toHaveLength(1)
    expect(idx.search('不存在词')).toHaveLength(0)
    expect(idx.search('')).toHaveLength(0)
    expect(idx.search('weather', { limit: 1 })).toHaveLength(1)
  })

  it('saveToFile / loadFromFile 往返', () => {
    const dir = track(makeTmpDir())
    const file = path.join(dir, 'knowledge-index.json')
    const idx = new KnowledgeIndex([
      { id: 'a', title: '标题A', content: '内容A', tags: ['t1'] },
    ])
    expect(idx.saveToFile(file)).toBe(true)
    const loaded = KnowledgeIndex.loadFromFile(file)
    expect(loaded.size()).toBe(1)
    expect(loaded.get('a')!.title).toBe('标题A')
  })

  it('加载不存在的文件返回空索引（不抛异常）', () => {
    const idx = KnowledgeIndex.loadFromFile('/no/such/knowledge-index.json')
    expect(idx.size()).toBe(0)
  })

  it('add 空 id 抛错（保护数据一致性）', () => {
    const idx = new KnowledgeIndex()
    expect(() => idx.add({ id: '', title: 'x' } as any)).toThrow()
  })
})

describe('P2: 插件 manifest', () => {
  it('校验合法 manifest', () => {
    const v = validateManifest({ name: 'my-skill', version: '1.0.0' })
    expect(v.valid).toBe(true)
    expect(v.errors).toEqual([])
  })

  it('校验缺 name/version 报错', () => {
    expect(validateManifest({ name: 'x' }).valid).toBe(false)
    expect(validateManifest({ version: '1.0' }).valid).toBe(false)
    expect(validateManifest({}).valid).toBe(false)
    expect(validateManifest(null).valid).toBe(false)
  })

  it('校验 capabilities/dependencies 类型', () => {
    expect(validateManifest({ name: 'a', version: '1', capabilities: ['code'] }).valid).toBe(true)
    expect(validateManifest({ name: 'a', version: '1', capabilities: 'code' }).valid).toBe(false)
    expect(validateManifest({ name: 'a', version: '1', capabilities: [1] }).valid).toBe(false)
    expect(validateManifest({ name: 'a', version: '1', dependencies: [1] }).valid).toBe(false)
    expect(validateManifest({ name: 'a', version: '1', entry: '' }).valid).toBe(false)
  })

  it('parseManifest 校验失败返回 null', () => {
    expect(parseManifest({ name: 'a' })).toBeNull()
    expect(parseManifest({ name: 'a', version: '1' })).not.toBeNull()
  })

  it('loadManifestFromFile 读取并校验', () => {
    const dir = track(makeTmpDir())
    const pluginDir = path.join(dir, 'my-plugin')
    fs.mkdirSync(pluginDir, { recursive: true })
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify({ name: 'my-plugin', version: '0.1.0', capabilities: ['search'] }),
    )
    const m = loadManifestFromFile(pluginDir)
    expect(m).not.toBeNull()
    expect(m!.name).toBe('my-plugin')
    expect(m!.capabilities).toEqual(['search'])
  })

  it('loadManifestFromFile 无 manifest.json 返回 null', () => {
    const dir = track(makeTmpDir())
    const pluginDir = path.join(dir, 'empty')
    fs.mkdirSync(pluginDir, { recursive: true })
    expect(loadManifestFromFile(pluginDir)).toBeNull()
  })

  it('loadManifestFromFile 损坏 JSON 返回 null（不抛异常）', () => {
    const dir = track(makeTmpDir())
    const pluginDir = path.join(dir, 'bad')
    fs.mkdirSync(pluginDir, { recursive: true })
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), 'not json{')
    expect(loadManifestFromFile(pluginDir)).toBeNull()
  })
})

describe('P2: 配置溯源快照 /debug/config', () => {
  it('maskSensitiveValues 掩盖敏感键', () => {
    const input = {
      llm: { api_key: 'sk-123', model: 'deepseek' },
      tools: { secret: 'abc', timeout: 5 },
      normal: 'ok',
      nested: { token: 't0', list: ['a', { password: 'p' }] },
    }
    const out = maskSensitiveValues(input)
    expect(out.llm.api_key).toBe('***')
    expect(out.llm.model).toBe('deepseek')
    expect(out.tools.secret).toBe('***')
    expect(out.tools.timeout).toBe(5)
    expect(out.normal).toBe('ok')
    expect(out.nested.token).toBe('***')
    expect(out.nested.list[1].password).toBe('***')
  })

  it('buildConfigSnapshot 返回脱敏快照 + sources + generated_at', () => {
    const cfg = new RuntimeConfig({ llm: { api_key: 'sk-secret' } })
    const snap = buildConfigSnapshot(cfg, { sources: { base: 'DEFAULT_CONFIG' } })
    expect(snap.generated_at).toBeTruthy()
    expect(snap.sources.base).toBe('DEFAULT_CONFIG')
    expect(snap.config.llm.api_key).toBe('***')
    // 未脱敏的常规字段保留
    expect(snap.config.llm.temperature).toBe(0.7)
  })

  it('buildDebugConfigHandler 处理 GET 返回 JSON', () => {
    const cfg = new RuntimeConfig({ llm: { api_key: 'sk-secret' } })
    const handler = buildDebugConfigHandler(cfg, { sources: { base: 'DEFAULT_CONFIG' } })
    let status = 0
    let body = ''
    const res = {
      writeHead: (s: number, h: any) => {
        status = s
      },
      end: (b: any) => {
        body = String(b)
      },
    }
    handler({ method: 'GET' }, res)
    expect(status).toBe(200)
    const parsed = JSON.parse(body)
    expect(parsed.config.llm.api_key).toBe('***')
    expect(parsed.config.llm.temperature).toBe(0.7)
  })

  it('buildDebugConfigHandler 非 GET 返回 405', () => {
    const cfg = new RuntimeConfig()
    const handler = buildDebugConfigHandler(cfg)
    let status = 0
    handler({ method: 'POST' }, {
      writeHead: (s: number) => {
        status = s
      },
      end: () => {},
    })
    expect(status).toBe(405)
  })
})

describe('P2: 回归（原有业务不受影响）', () => {
  it('RuntimeConfig 基础行为不变', () => {
    const cfg = new RuntimeConfig()
    expect(cfg.get('llm.default_provider', null)).toBe('deepseek')
    expect(cfg.get('llm.temperature', null)).toBe(0.7)
    expect(cfg.get('memory.default_strategy', null)).toBe('cache')
  })

  it('asDict 仍返回深拷贝（脱敏快照不改变内部状态）', () => {
    const cfg = new RuntimeConfig({ llm: { api_key: 'sk-secret' } })
    buildConfigSnapshot(cfg)
    // 快照构建不应污染/暴露内部密钥对象
    expect(cfg.asDict().llm.api_key).toBe('sk-secret')
  })
})
