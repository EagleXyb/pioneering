import { describe, it, expect } from 'vitest';
import { CARD_GAP, CARD_WIDTH, resolveCardPlacement } from './cardPlacement';

/** 右侧放得下所需的完整余量（卡片宽度 + 间距） */
const NEED = CARD_WIDTH + CARD_GAP;

describe('resolveCardPlacement', () => {
  it('右侧余量充足：放在右侧，宽度不缩减', () => {
    // 视口 1400，菜单右缘 1000 → 右侧余量 388 ≥ 310
    expect(
      resolveCardPlacement({ menuLeft: 780, menuRight: 1000, viewportWidth: 1400 }),
    ).toEqual({ side: 'right', maxWidth: CARD_WIDTH });
  });

  it('右侧放不下而左侧充足：翻到左侧，仍不溢出', () => {
    // 典型窄窗：视口 1130，菜单 [871, 1091] → 右侧仅 27，左侧 859
    expect(
      resolveCardPlacement({ menuLeft: 871, menuRight: 1091, viewportWidth: 1130 }),
    ).toEqual({ side: 'left', maxWidth: CARD_WIDTH });
  });

  it('两侧都不足：取余量更大的一侧并按余量收窄', () => {
    // 视口 420，菜单 [100, 300] → 右侧 108 > 左侧 88，均不足 230
    expect(
      resolveCardPlacement({ menuLeft: 100, menuRight: 300, viewportWidth: 420 }),
    ).toEqual({ side: 'right', maxWidth: 108 });

    // 视口 420，菜单 [200, 400] → 左侧 188 > 右侧 8
    expect(
      resolveCardPlacement({ menuLeft: 200, menuRight: 400, viewportWidth: 420 }),
    ).toEqual({ side: 'left', maxWidth: 188 });
  });

  it('余量恰好等于需求时仍用右侧（边界不提前翻转）', () => {
    const viewportWidth = 700 + NEED + 12;
    expect(
      resolveCardPlacement({ menuLeft: 0, menuRight: 700, viewportWidth }),
    ).toEqual({ side: 'right', maxWidth: CARD_WIDTH });
  });

  it('极端窄视口：宽度不为负，且始终不超出视口', () => {
    const placement = resolveCardPlacement({
      menuLeft: 5,
      menuRight: 215,
      viewportWidth: 220,
    });
    expect(placement.maxWidth).toBeGreaterThanOrEqual(0);
    expect(placement.maxWidth).toBeLessThanOrEqual(CARD_WIDTH);
  });
});
