// dataset-loader 测试：数据集构建 / 预处理 / 采样可复现 / 引用继承
import { describe, expect, it } from 'vitest'
import {
  buildDataset,
  loadDatasetRegistry,
  loadPreprocessing,
} from '../src/dataset-loader.js'

describe('数据集注册表（真实 datasets.yaml）', () => {
  const registry = loadDatasetRegistry()
  const pp = loadPreprocessing()

  it('smoke 数据集 = core.yaml 全量（预处理后）', () => {
    const ds = buildDataset(registry, 'smoke', pp)
    expect(ds.name).toBe('smoke')
    // core.yaml 有 6 条，无 draft 标签 -> 全部保留
    expect(ds.cases.length).toBe(6)
    expect(ds.cases.every((c) => c.category === 'core')).toBe(true)
  })

  it('full 数据集合并三个用例文件（引用继承）且 id 去重', () => {
    const ds = buildDataset(registry, 'full', pp)
    const ids = ds.cases.map((c) => c.id)
    // core 6 + edge 5（draft 被过滤）+ regression 2
    expect(ids.length).toBe(13)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('reg-multistep-001')
    expect(ids).not.toContain('edge-draft-001')
  })

  it('占位符 {{date}} 被替换为固定值（可复现性）', () => {
    const ds = buildDataset(registry, 'smoke', pp)
    const c = ds.cases.find((x) => x.id === 'core-datetime-001')
    expect(c?.input).toContain('2026-08-20')
    expect(c?.input).not.toContain('{{date}}')
  })

  it('exclude_tags 过滤 draft 用例', () => {
    const ds = buildDataset(registry, 'full', pp)
    expect(ds.cases.find((c) => c.id === 'edge-draft-001')).toBeUndefined()
  })

  it('dev 数据集随机采样可复现（同 seed 同结果）', () => {
    const a = buildDataset(registry, 'dev', pp)
    const b = buildDataset(registry, 'dev', pp)
    expect(a.cases.map((c) => c.id)).toEqual(b.cases.map((c) => c.id))
    expect(a.cases.length).toBe(4)
  })

  it('未注册数据集抛错并列出可用项', () => {
    expect(() => buildDataset(registry, 'nope', pp)).toThrow(/smoke|full|regression|dev/)
  })

  it('用例字段规范化（缺省 category/source 兜底）', () => {
    const ds = buildDataset(registry, 'smoke', pp)
    const c = ds.cases[0]
    expect(Array.isArray(c.tags)).toBe(true)
    expect(['human', 'synthetic', 'production', 'failure']).toContain(c.source)
  })
})
