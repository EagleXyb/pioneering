/**
 * extractCodeBlocks 单元测试
 *
 * 覆盖场景：
 *   - 标准围栏代码块（``` 和 ~~~）
 *   - 带语言标签 / 无语言标签
 *   - 多代码块混合
 *   - 嵌入文本中的代码块
 *   - 边界：空字符串、纯文本无代码块
 *   - isPreviewable 判定
 */
import { describe, it, expect } from 'vitest';
import { extractCodeBlocks, isPreviewable } from './extractCodeBlocks';

describe('extractCodeBlocks', () => {
  it('提取标准 ```html 代码块', () => {
    const text = '前面文字\n```html\n<div>hello</div>\n```\n后面文字';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe('html');
    expect(blocks[0].code).toBe('<div>hello</div>');
  });

  it('提取 ```svg 代码块', () => {
    const text = '```svg\n<svg></svg>\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe('svg');
    expect(blocks[0].code).toBe('<svg></svg>');
  });

  it('提取 ~~~ 围栏代码块', () => {
    const text = '~~~python\nprint(1)\n~~~';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe('python');
    expect(blocks[0].code).toBe('print(1)');
  });

  it('无语言标签时 language 为空字符串', () => {
    const text = '```\ncode here\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe('');
    expect(blocks[0].code).toBe('code here');
  });

  it('语言标签统一转小写', () => {
    const text = '```HTML\n<div></div>\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks[0].language).toBe('html');
  });

  it('提取多个代码块并保留顺序', () => {
    const text = '```html\n<a></a>\n```\n中间文本\n```python\nx=1\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].language).toBe('html');
    expect(blocks[0].code).toBe('<a></a>');
    expect(blocks[1].language).toBe('python');
    expect(blocks[1].code).toBe('x=1');
  });

  it('start/end 偏移正确指向代码块位置', () => {
    const text = 'abc\n```html\n<div></div>\n```\ndef';
    const blocks = extractCodeBlocks(text);
    expect(blocks[0].start).toBe(4); // 'abc\n' 之后
    // 验证 slice(start, end) 能取到围栏本身
    const sliced = text.slice(blocks[0].start, blocks[0].end);
    expect(sliced).toContain('```html');
    expect(sliced).toContain('<div></div>');
  });

  it('空字符串返回空数组', () => {
    expect(extractCodeBlocks('')).toEqual([]);
  });

  it('纯文本无代码块返回空数组', () => {
    expect(extractCodeBlocks('这是一段普通文字，没有代码块')).toEqual([]);
  });

  it('代码块内容可包含空行', () => {
    const text = '```js\nconst x = 1;\n\nconst y = 2;\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('const x = 1;\n\nconst y = 2;');
  });

  it('代码块内容可包含特殊字符', () => {
    const text = '```html\n<div data-x="1" class="a b">中文 &amp; 特殊</div>\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks[0].code).toBe('<div data-x="1" class="a b">中文 &amp; 特殊</div>');
  });
});

describe('isPreviewable', () => {
  it('html 可预览', () => {
    expect(isPreviewable('html')).toBe(true);
  });

  it('svg 可预览', () => {
    expect(isPreviewable('svg')).toBe(true);
  });

  it('python 不可预览', () => {
    expect(isPreviewable('python')).toBe(false);
  });

  it('空字符串不可预览', () => {
    expect(isPreviewable('')).toBe(false);
  });

  it('大小写不敏感（调用方应先转小写）', () => {
    // isPreviewable 内部做严格相等比较，调用方需转小写
    expect(isPreviewable('HTML')).toBe(false);
    expect(isPreviewable('Svg')).toBe(false);
  });
});
