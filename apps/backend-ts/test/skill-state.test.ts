/**
 * 技能启用状态持久化（L3-1.3）—— 文件实现单测
 *
 * 语义：文件存在则覆盖 config.yaml；缺失/损坏回退 config.yaml。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { RuntimeConfig, resetConfig, getConfig } from '@pioneering/modu-agent'
import {
  applyPersistedSkillState,
  readSkillState,
  setActiveSkills,
  skillStatePath,
  writeSkillState,
} from '../src/core/skill-state.js'

let tmpDir = ''

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-state-'))
  resetConfig()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const file = () => path.join(tmpDir, 'nested', 'skills.state.json')

describe('writeSkillState / readSkillState', () => {
  it('写入后读回：去重 + 排序 + 元信息', () => {
    const state = writeSkillState(['writer', 'math', 'math'], 'admin-1', file())
    expect(state.active).toEqual(['math', 'writer'])
    expect(state.updatedBy).toBe('admin-1')

    const back = readSkillState(file())
    expect(back?.active).toEqual(['math', 'writer'])
    expect(back?.updatedAt).toBe(state.updatedAt)
  })

  it('文件缺失 → null', () => {
    expect(readSkillState(path.join(tmpDir, 'none.json'))).toBeNull()
  })

  it('文件损坏 → null（不抛异常）', () => {
    const p = path.join(tmpDir, 'broken.json')
    fs.writeFileSync(p, '{not-json', 'utf8')
    expect(readSkillState(p)).toBeNull()
  })

  it('非法元素被过滤', () => {
    const p = path.join(tmpDir, 'mixed.json')
    fs.writeFileSync(p, JSON.stringify({ active: ['math', 1, null, 'writer'] }), 'utf8')
    expect(readSkillState(p)?.active).toEqual(['math', 'writer'])
  })
})

describe('applyPersistedSkillState', () => {
  it('无文件 → applied=false，保留 config 值', () => {
    const cfg = new RuntimeConfig({ skills: { enabled: true, active: ['yaml-skill'] } })
    const r = applyPersistedSkillState(cfg, file())
    expect(r).toEqual({ applied: false, active: ['yaml-skill'] })
    expect(cfg.get('skills.active')).toEqual(['yaml-skill'])
  })

  it('有文件 → 覆盖 config（文件优先）', () => {
    writeSkillState(['math'], 'admin', file())
    const cfg = new RuntimeConfig({ skills: { enabled: true, active: ['yaml-skill'] } })
    const r = applyPersistedSkillState(cfg, file())
    expect(r).toEqual({ applied: true, active: ['math'] })
    expect(cfg.get('skills.active')).toEqual(['math'])
  })
})

describe('setActiveSkills', () => {
  it('落盘并同步到全局配置', () => {
    const state = setActiveSkills(['math'], 'admin-2', file())
    expect(state.active).toEqual(['math'])
    expect(getConfig().get('skills.active')).toEqual(['math'])
    expect(readSkillState(file())?.active).toEqual(['math'])
  })

  it('skillStatePath 解析为绝对路径', () => {
    expect(path.isAbsolute(skillStatePath('./x.json'))).toBe(true)
  })
})
