// P0-2 单元测试：CoT 锚点与反思后缀
// 对应文档 P0-2：按 tier 条件拼接锚点模板与反思后缀
import { describe, it, expect } from 'vitest'
import {
  COT_ANCHOR_TEMPLATE,
  REFLECTION_SUFFIX,
  TIER_COT_CONFIG,
  composeCotPrompt,
} from '@/reasoning/cot-anchors.js'

describe('P0-2 CoT Anchors', () => {
  // ============================================================
  // 锚点模板与反思后缀常量
  // ============================================================
  describe('常量定义', () => {
    it('COT_ANCHOR_TEMPLATE 含六项结构化锚点', () => {
      expect(COT_ANCHOR_TEMPLATE).toContain('[Current Goal]')
      expect(COT_ANCHOR_TEMPLATE).toContain('[Known Info]')
      expect(COT_ANCHOR_TEMPLATE).toContain('[Missing Info]')
      expect(COT_ANCHOR_TEMPLATE).toContain('[Next Step]')
      expect(COT_ANCHOR_TEMPLATE).toContain('[Expected Result]')
      expect(COT_ANCHOR_TEMPLATE).toContain('[Risk Preview]')
    })

    it('REFLECTION_SUFFIX 含三项自检提示', () => {
      expect(REFLECTION_SUFFIX).toContain('logical leap')
      expect(REFLECTION_SUFFIX).toContain('more efficient tool')
      expect(REFLECTION_SUFFIX).toContain('fallback')
    })
  })

  // ============================================================
  // Tier 配置映射
  // ============================================================
  describe('TIER_COT_CONFIG', () => {
    it('tier_1 默认不启用锚点与反思（快速直答）', () => {
      expect(TIER_COT_CONFIG.tier_1.enable_anchor).toBe(false)
      expect(TIER_COT_CONFIG.tier_1.enable_reflection).toBe(false)
    })

    it('tier_2 启用锚点但不启用反思（控制延迟）', () => {
      expect(TIER_COT_CONFIG.tier_2.enable_anchor).toBe(true)
      expect(TIER_COT_CONFIG.tier_2.enable_reflection).toBe(false)
    })

    it('tier_3 启用锚点与反思（深度推理）', () => {
      expect(TIER_COT_CONFIG.tier_3.enable_anchor).toBe(true)
      expect(TIER_COT_CONFIG.tier_3.enable_reflection).toBe(true)
    })
  })

  // ============================================================
  // composeCotPrompt 按 tier 拼接
  // ============================================================
  describe('composeCotPrompt', () => {
    it('tier_1 返回空字符串（不启用）', () => {
      expect(composeCotPrompt('tier_1')).toBe('')
    })

    it('tier_2 仅含锚点模板，不含反思后缀', () => {
      const r = composeCotPrompt('tier_2')
      expect(r).toContain(COT_ANCHOR_TEMPLATE)
      expect(r).not.toContain(REFLECTION_SUFFIX)
    })

    it('tier_3 含锚点模板 + 反思后缀', () => {
      const r = composeCotPrompt('tier_3')
      expect(r).toContain(COT_ANCHOR_TEMPLATE)
      expect(r).toContain(REFLECTION_SUFFIX)
    })

    it('tier=null 按 tier_2 处理（等价默认行为）', () => {
      const r = composeCotPrompt(null)
      expect(r).toBe(composeCotPrompt('tier_2'))
    })

    it('tier=undefined 按 tier_2 处理', () => {
      const r = composeCotPrompt(undefined)
      expect(r).toBe(composeCotPrompt('tier_2'))
    })

    it('forceEnable=true 时 tier_1 也启用锚点 + 反思', () => {
      const r = composeCotPrompt('tier_1', true)
      expect(r).toContain(COT_ANCHOR_TEMPLATE)
      expect(r).toContain(REFLECTION_SUFFIX)
    })

    it('forceEnable=false 时遵循 tier 配置', () => {
      expect(composeCotPrompt('tier_1', false)).toBe('')
      expect(composeCotPrompt('tier_3', false)).toContain(COT_ANCHOR_TEMPLATE)
    })

    it('锚点与反思之间以双换行分隔', () => {
      const r = composeCotPrompt('tier_3')
      expect(r).toContain(`${COT_ANCHOR_TEMPLATE}\n\n${REFLECTION_SUFFIX}`)
    })
  })

  // ============================================================
  // 向后兼容
  // ============================================================
  describe('向后兼容', () => {
    it('tier_2/默认拼接结果非空，保证 feature flag 启用时生效', () => {
      expect(composeCotPrompt('tier_2').length).toBeGreaterThan(0)
    })
  })
})
