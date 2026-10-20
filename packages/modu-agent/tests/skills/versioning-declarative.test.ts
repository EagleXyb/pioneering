// L3-2：声明式技能 + 路径安全 + 内容指纹 / 快照 / 回滚
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { SkillLoader, isInsideDir } from '@/skills/loader.js'
import { RuntimeConfig } from '@/config/runtime-config.js'
import {
  cleanupSnapshots,
  computeSkillContentHash,
  findSnapshot,
  getSkillMeta,
  readVersionState,
  resetSkillMetaForTest,
  setDefaultVersion,
  snapshotDirFor,
} from '@/skills/versioning.js'

let baseDir = ''

function cfg(): RuntimeConfig {
  return new RuntimeConfig({
    skills: { enabled: true, active: [], auto_discover_dirs: [baseDir], versioning: { enabled: true } },
  })
}

function writeDeclarative(
  name: string,
  version: string,
  prompt: string,
  extra: Record<string, any> = {},
): string {
  const dir = path.join(baseDir, name)
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      name,
      version,
      description: `${name} 描述`,
      tags: ['demo'],
      ...extra,
    }),
    'utf8',
  )
  fs.writeFileSync(path.join(dir, 'prompts', 'system.md'), prompt, 'utf8')
  return dir
}

async function discover() {
  return new SkillLoader({} as any, cfg()).discover([baseDir])
}

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-version-'))
  resetSkillMetaForTest()
})

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('版本基础设施', () => {
  it('isInsideDir：根内为 true，逃逸为 false', () => {
    expect(isInsideDir(baseDir, path.join(baseDir, 'a'))).toBe(true)
    expect(isInsideDir(baseDir, path.join(baseDir, '..', 'evil'))).toBe(false)
  })

  it('内容指纹：同内容同 hash，内容变化 hash 变化', () => {
    const dir = writeDeclarative('writer', '1.0.0', '正文 A')
    const h1 = computeSkillContentHash(dir)
    const h2 = computeSkillContentHash(dir)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64)

    fs.writeFileSync(path.join(dir, 'prompts', 'system.md'), '正文 B', 'utf8')
    expect(computeSkillContentHash(dir)).not.toBe(h1)
  })

  it('空目录 hash 为空串', () => {
    const empty = path.join(baseDir, 'empty')
    fs.mkdirSync(empty)
    expect(computeSkillContentHash(empty)).toBe('')
  })
})

describe('声明式技能发现（2.1）', () => {
  it('manifest + prompts/system.md → 纯提示型技能（无工具）', async () => {
    writeDeclarative('writer', '1.0.0', '# 写作规范\n先列提纲。')

    const list = await discover()
    expect(list).toHaveLength(1)
    const skill = list[0]
    expect(skill.name()).toBe('writer')
    expect(skill.version()).toBe('1.0.0')
    expect(skill.tools()).toEqual([])
    expect(skill.systemPromptFragment()).toContain('先列提纲')

    const meta = getSkillMeta('writer')
    expect(meta?.version).toBe('1.0.0')
    expect(meta?.contentHash).toHaveLength(64)
    expect(meta?.fromSnapshot).toBe(false)
  })

  it('manifest 非法（缺 version）→ 跳过并记录 error', async () => {
    writeDeclarative('broken', '', 'x')
    const list = await discover()
    expect(list).toHaveLength(0)
    expect(getSkillMeta('broken')?.error).toContain('manifest')
  })

  it('依赖缺失 → 跳过该技能', async () => {
    writeDeclarative('a', '1.0.0', 'A', { dependencies: ['ghost'] })
    writeDeclarative('b', '1.0.0', 'B')

    const list = await discover()
    const names = list.map((s) => s.name())
    expect(names).toEqual(['b'])
  })

  it('依赖存在 → 正常加载', async () => {
    writeDeclarative('base', '1.0.0', 'BASE')
    writeDeclarative('a', '1.0.0', 'A', { dependencies: ['base'] })

    const names = (await discover()).map((s) => s.name())
    expect(names.sort()).toEqual(['a', 'base'])
  })

  it('隐藏目录（.snapshots）不参与发现', async () => {
    writeDeclarative('writer', '1.0.0', 'W')
    await discover() // 生成 .snapshots
    const names = (await discover()).map((s) => s.name())
    expect(names).toEqual(['writer'])
  })
})

describe('版本快照与回滚（2.3 / 2.4）', () => {
  it('首次发现：生成快照并记录默认版本', async () => {
    writeDeclarative('writer', '1.0.0', 'V1')
    await discover()

    const state = readVersionState(baseDir)
    expect(state.writer?.defaultVersion).toBe('1.0.0')
    const hash = state.writer?.versions['1.0.0']?.hash
    expect(hash).toHaveLength(64)
    expect(fs.existsSync(snapshotDirFor(baseDir, 'writer', '1.0.0', hash as string))).toBe(true)
  })

  it('升版本：默认版本自动前移，并保留两个快照', async () => {
    writeDeclarative('writer', '1.0.0', 'V1')
    await discover()

    writeDeclarative('writer', '2.0.0', 'V2')
    const list = await discover()
    expect(list[0].version()).toBe('2.0.0')

    const state = readVersionState(baseDir)
    expect(state.writer?.defaultVersion).toBe('2.0.0')
    expect(Object.keys(state.writer?.versions ?? {}).sort()).toEqual(['1.0.0', '2.0.0'])
  })

  it('回滚：指针钉住旧版本，随后从快照加载（内容为旧版）', async () => {
    writeDeclarative('writer', '1.0.0', 'OLD-PROMPT')
    await discover()
    writeDeclarative('writer', '2.0.0', 'NEW-PROMPT')
    await discover()

    const rolled = setDefaultVersion(baseDir, 'writer', '1.0.0')
    expect(rolled.ok).toBe(true)
    expect(rolled.snapshot).toBeTruthy()

    resetSkillMetaForTest()
    const list = await discover()
    expect(list[0].version()).toBe('1.0.0')
    expect(list[0].systemPromptFragment()).toContain('OLD-PROMPT')

    const meta = getSkillMeta('writer')
    expect(meta?.fromSnapshot).toBe(true)

    // 钉住后，工作副本仍是 2.0.0 也不会自动前移
    expect(readVersionState(baseDir).writer?.defaultVersion).toBe('1.0.0')
    expect(readVersionState(baseDir).writer?.pinned).toBe(true)
  })

  it('同版本改内容：记为冲突，不静默切换', async () => {
    writeDeclarative('writer', '1.0.0', 'V1')
    await discover()

    writeDeclarative('writer', '1.0.0', 'V1-CHANGED')
    await discover()

    const meta = getSkillMeta('writer')
    expect(meta?.error).toContain('版本未递增')
    expect(readVersionState(baseDir).writer?.defaultVersion).toBe('1.0.0')
  })

  it('回滚到不存在的版本 → 失败并给出原因', async () => {
    writeDeclarative('writer', '1.0.0', 'V1')
    await discover()
    const r = setDefaultVersion(baseDir, 'writer', '9.9.9')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('9.9.9')
  })
})

describe('快照回收（5.2）', () => {
  async function threeVersions(): Promise<void> {
    writeDeclarative('writer', '1.0.0', 'V1')
    await discover()
    writeDeclarative('writer', '2.0.0', 'V2')
    await discover()
    writeDeclarative('writer', '3.0.0', 'V3')
    await discover()
  }

  it('保留最近 N 个，默认版本永不删除', async () => {
    await threeVersions()
    // 固定 mtime：v1 最旧、v3 最新
    const dirs = ['1.0.0', '2.0.0', '3.0.0'].map((v) => findSnapshot(baseDir, 'writer', v))
    expect(dirs.every(Boolean)).toBe(true)
    const base = Date.now() / 1000
    dirs.forEach((d, i) => fs.utimesSync(d as string, base - (3 - i) * 60, base - (3 - i) * 60))

    const r = cleanupSnapshots(baseDir, { keepLast: 1, maxAgeDays: 0 })

    expect(r.removed).toHaveLength(2)
    // 默认版本（3.0.0）保留
    expect(fs.existsSync(findSnapshot(baseDir, 'writer', '3.0.0') as string)).toBe(true)
    expect(r.removed.some((p) => p.includes('3.0.0+'))).toBe(false)
  })

  it('dryRun：只报告不删除', async () => {
    await threeVersions()
    const r = cleanupSnapshots(baseDir, { keepLast: 1, maxAgeDays: 0, dryRun: true })
    expect(r.removed).toHaveLength(2)
    expect(fs.existsSync(findSnapshot(baseDir, 'writer', '1.0.0') as string)).toBe(true)
  })

  it('回滚钉住的旧版本不会被回收', async () => {
    await threeVersions()
    setDefaultVersion(baseDir, 'writer', '1.0.0')
    const r = cleanupSnapshots(baseDir, { keepLast: 1, maxAgeDays: 0 })
    expect(r.removed.some((p) => p.includes('1.0.0+'))).toBe(false)
    expect(fs.existsSync(findSnapshot(baseDir, 'writer', '1.0.0') as string)).toBe(true)
  })

  it('目录不存在 → 空结果（不抛异常）', () => {
    expect(cleanupSnapshots(path.join(baseDir, 'nope'))).toEqual({ removed: [], kept: 0 })
  })
})
