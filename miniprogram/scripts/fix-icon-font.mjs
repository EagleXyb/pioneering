/**
 * 将 tdesign icon.wxss 中的 CDN 字体引用替换为 base64 内联
 * 微信小程序 wxss 不支持 @font-face 本地相对路径，必须内联 base64
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const iconCssPath = resolve(__dirname, '..', 'dist/npm/tdesign-miniprogram/icon/icon.wxss');
const fontPath = resolve(__dirname, '..', 'src/assets/fonts/t.woff');

try {
  let content = readFileSync(iconCssPath, 'utf-8');
  const fontBase64 = readFileSync(fontPath, 'base64');

  // 将整个 @font-face 块替换为 base64 内联版本（仅保留 woff 格式）
  content = content.replace(
    /@font-face\{font-family:t;[^}]*\}/,
    `@font-face{font-family:t;font-style:normal;font-weight:400;src:url(data:application/font-woff;charset=utf-8;base64,${fontBase64}) format("woff")}`
  );

  writeFileSync(iconCssPath, content, 'utf-8');
  console.log('✓ icon font inlined as base64');
} catch (e) {
  console.error('Failed to fix icon font URLs:', e.message);
  process.exit(1);
}