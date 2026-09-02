import { describe, it, expect } from 'vitest'
import {
  selectListReducer,
  type SelectListState
} from '../select-list'

const base: SelectListState = { open: false, activeIdx: 0 }

describe('selectListReducer', () => {
  it('OPEN：展开并把高亮重置到当前选中项', () => {
    const s = selectListReducer(base, { type: 'OPEN', selectedIndex: 2 })
    expect(s).toEqual({ open: true, activeIdx: 2 })
  })

  it('OPEN：选中项索引为 -1（找不到）时安全回退到 0', () => {
    const s = selectListReducer(base, { type: 'OPEN', selectedIndex: -1 })
    expect(s).toEqual({ open: true, activeIdx: 0 })
  })

  it('CLOSE：关闭下拉但保留 activeIdx', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 3 })
    const s = selectListReducer(open, { type: 'CLOSE' })
    expect(s.open).toBe(false)
    expect(s.activeIdx).toBe(3)
  })

  it('HOVER：鼠标悬停更新高亮', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 0 })
    const s = selectListReducer(open, { type: 'HOVER', index: 1 })
    expect(s.activeIdx).toBe(1)
    expect(s.open).toBe(true)
  })

  it('ARROW_DOWN：高亮下移一位', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 0 })
    const s = selectListReducer(open, { type: 'ARROW_DOWN', optionCount: 4 })
    expect(s.activeIdx).toBe(1)
  })

  it('ARROW_DOWN：末位循环回开头', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 3 })
    const s = selectListReducer(open, { type: 'ARROW_DOWN', optionCount: 4 })
    expect(s.activeIdx).toBe(0)
  })

  it('ARROW_UP：高亮上移一位', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 2 })
    const s = selectListReducer(open, { type: 'ARROW_UP', optionCount: 4 })
    expect(s.activeIdx).toBe(1)
  })

  it('ARROW_UP：首位循环回末尾', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 0 })
    const s = selectListReducer(open, { type: 'ARROW_UP', optionCount: 4 })
    expect(s.activeIdx).toBe(3)
  })

  it('ARROW_DOWN/UP：optionCount 为 0 时不产生非法索引', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 0 })
    expect(selectListReducer(open, { type: 'ARROW_DOWN', optionCount: 0 }).activeIdx).toBe(0)
    expect(selectListReducer(open, { type: 'ARROW_UP', optionCount: 0 }).activeIdx).toBe(0)
  })

  it('ESC：关闭下拉', () => {
    const open = selectListReducer(base, { type: 'OPEN', selectedIndex: 1 })
    expect(selectListReducer(open, { type: 'ESC' }).open).toBe(false)
  })

  it('完整交互序列：打开→下移→上移→悬停→关闭', () => {
    let s = base
    s = selectListReducer(s, { type: 'OPEN', selectedIndex: 0 })
    s = selectListReducer(s, { type: 'ARROW_DOWN', optionCount: 3 })
    s = selectListReducer(s, { type: 'ARROW_UP', optionCount: 3 })
    s = selectListReducer(s, { type: 'HOVER', index: 2 })
    expect(s).toEqual({ open: true, activeIdx: 2 })
    s = selectListReducer(s, { type: 'ESC' })
    expect(s.open).toBe(false)
  })
})
