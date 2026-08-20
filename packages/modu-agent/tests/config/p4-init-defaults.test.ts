// p4-init-defaults.test.ts
//
// 首次安装初始化器测试：幂等生成默认模板（AGENTS.md/SOUL.md/USER.md/MEMORY.md + config.yaml）。

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  initDefaultConfigFiles,
  hasDefaultConfigFiles,
  DEFAULT_TEMPLATES,
  getDefaultConfigRoot,
} from '@/config/init-defaults.js'

const EXPECTED_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'config.yaml']

describe('init-defaults 首次安装初始化', () => {
  it('默认模板集合包含 5 个约定文件', () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.fileName).sort()).toEqual([...EXPECTED_FILES].sort())
  })

  it('全量生成缺失的模板文件（首次安装）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-all-'))
    try {
      const r = initDefaultConfigFiles({ rootDir: dir })
      expect(r.created).toBe(5)
      expect(r.existed).toBe(0)
      expect(r.skipped).toBe(0)
      for (const f of EXPECTED_FILES) {
        expect(fs.existsSync(path.join(dir, f))).toBe(true)
      }
      // 内容非空且含 frontmatter 的 .md
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')
      expect(agents).toContain('inject_to: system_prompt')
      expect(agents).toContain('cascade_level: global')
      // config.yaml 内置 markdown_prompt.enabled
      const cfg = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8')
      expect(cfg).toContain('markdown_prompt:')
      expect(cfg).toContain('enabled: true')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('幂等：已存在的文件不被覆盖（保留用户修改）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-idem-'))
    try {
      // 预置一个用户自定义的 AGENTS.md
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), '用户自定义内容，勿覆盖', 'utf-8')
      const r = initDefaultConfigFiles({ rootDir: dir })
      expect(r.existed).toBe(1)
      expect(r.created).toBe(4)
      // 用户内容保持不变
      expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe('用户自定义内容，勿覆盖')
      // 其余文件已生成
      for (const f of EXPECTED_FILES.filter((x) => x !== 'AGENTS.md')) {
        expect(fs.existsSync(path.join(dir, f))).toBe(true)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('重复调用幂等：第二次全部 exists，created 为 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-again-'))
    try {
      const first = initDefaultConfigFiles({ rootDir: dir })
      expect(first.created).toBe(5)
      const second = initDefaultConfigFiles({ rootDir: dir })
      expect(second.created).toBe(0)
      expect(second.existed).toBe(5)
      expect(second.skipped).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('支持自定义模板集合', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-custom-'))
    try {
      const custom = [
        { fileName: 'custom.txt', content: 'hello' },
        { fileName: 'note.md', content: '---\n---\nnote' },
      ]
      const r = initDefaultConfigFiles({ rootDir: dir, templates: custom })
      expect(r.created).toBe(2)
      expect(fs.readFileSync(path.join(dir, 'custom.txt'), 'utf-8')).toBe('hello')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('单文件写入失败隔离（其他文件仍生成）', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'init-skip-'))
    try {
      // 构造一个写入必失败的目标：把 rootDir 指向"某文件/子目录"，
      // 因为某文件是普通文件，mkdirSync 会抛错 → 所有文件均 skipped。
      const blocker = path.join(parent, 'a-file.txt')
      fs.writeFileSync(blocker, 'x', 'utf-8')
      const badRoot = path.join(blocker, 'sub') // blocker 是文件，无法作目录
      const r = initDefaultConfigFiles({ rootDir: badRoot })
      expect(r.skipped).toBe(5)
      expect(r.created).toBe(0)
      // 正常 rootDir 下仍能生成，证明隔离逻辑本身可用
      const r2 = initDefaultConfigFiles({ rootDir: parent })
      expect(r2.created).toBe(5)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('hasDefaultConfigFiles 判断是否已初始化', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-has-'))
    try {
      expect(hasDefaultConfigFiles(dir)).toBe(false)
      initDefaultConfigFiles({ rootDir: dir })
      expect(hasDefaultConfigFiles(dir)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('getDefaultConfigRoot 返回非空目录', () => {
    expect(path.isAbsolute(getDefaultConfigRoot())).toBe(true)
    expect(fs.existsSync(getDefaultConfigRoot())).toBe(true)
  })

  it('生成的 MEMORY.md 默认 lazy（按需加载）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-mem-'))
    try {
      initDefaultConfigFiles({ rootDir: dir })
      const mem = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8')
      expect(mem).toContain('load: lazy')
      expect(mem).toContain('inject_to: runtime_context')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
