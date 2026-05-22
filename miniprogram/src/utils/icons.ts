/**
 * 导航栏 SVG 图标 - 内联 base64，无网络依赖
 */

interface IconOptions {
  size?: number;   // px
  color?: string;
}

/** 列表图标：上部长线 + 下部短线 */
function createViewListSvg({ size = 24, color = '#333333' }: IconOptions = {}): string {
  const svg = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 6H22V10H2V6Z" fill="${color}"/><path d="M2 14H14V18H2V14Z" fill="${color}"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

/** 新建图标：圆形 + 十字加号 */
function createAddSvg({ size = 24, color = '#333333' }: IconOptions = {}): string {
  const svg = `<svg viewBox="0 0 1024 1024" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="512" cy="512" r="384" stroke="${color}" stroke-width="64"/><path d="M512 320v384M320 512h384" stroke="${color}" stroke-width="64" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export const NavIcons = {
  viewList: createViewListSvg,
  add: createAddSvg,
};