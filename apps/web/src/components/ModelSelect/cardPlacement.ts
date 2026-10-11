/**
 * 模型详情卡的落位计算
 *
 * 卡片绝对定位在菜单内、以菜单为参照，因此「是否溢出视口」只取决于菜单相对视口的位置。
 * 规则：
 * 1. 优先放在菜单右侧（与参照图一致）；
 * 2. 右侧余量不足时翻到左侧，绝不越过视口边缘；
 * 3. 两侧都不足（视口极窄）时取余量更大的一侧，并按该侧余量收窄卡片宽度。
 */

/** 卡片设计宽度（与 ModelSelect.css 的 width 保持一致） */
export const CARD_WIDTH = 220;
/** 卡片与菜单之间的间距 */
export const CARD_GAP = 10;
/** 卡片与视口边缘的最小留白 */
export const VIEWPORT_MARGIN = 12;

export interface CardPlacement {
  /** 卡片相对菜单的展开方向 */
  side: 'right' | 'left';
  /** 卡片宽度上限：两侧余量都不足时按可用余量收窄，保证不溢出视口 */
  maxWidth: number;
}

export function resolveCardPlacement(input: {
  menuLeft: number;
  menuRight: number;
  viewportWidth: number;
}): CardPlacement {
  const { menuLeft, menuRight, viewportWidth } = input;
  const need = CARD_WIDTH + CARD_GAP;
  const roomRight = viewportWidth - menuRight - VIEWPORT_MARGIN;
  const roomLeft = menuLeft - VIEWPORT_MARGIN;

  const side: CardPlacement['side'] =
    roomRight >= need || roomRight >= roomLeft ? 'right' : 'left';

  const room = Math.max(0, side === 'right' ? roomRight : roomLeft);

  return { side, maxWidth: Math.min(CARD_WIDTH, room) };
}
