/**
 * toolAction 单元测试 —— 工具调用 → 动作摘要（截图同款“动词 + 目标对象”）
 */
import { describe, it, expect } from 'vitest';
import { describeToolAction, extractToolTarget, truncateTarget } from './toolAction';

describe('describeToolAction', () => {
  it('已知工具映射为动词与图标', () => {
    expect(describeToolAction('library').verb).toBe('加载技能');
    expect(describeToolAction('web_search').verb).toBe('联网搜索');
    expect(describeToolAction('read_file').verb).toBe('查看文件');
    expect(describeToolAction('bash').verb).toBe('运行命令');
    expect(describeToolAction('grep').verb).toBe('搜索代码');
  });

  it('从完整 JSON 参数中提取目标对象', () => {
    const d = describeToolAction('read_file', '{"path":"entry.md","offset":0}');
    expect(d.verb).toBe('查看文件');
    expect(d.target).toBe('entry.md');
  });

  it('流式未闭合 JSON：正则粗提取仍能给出目标', () => {
    const d = describeToolAction('bash', '{"command":"node scripts/check.js"');
    expect(d.verb).toBe('运行命令');
    expect(d.target).toBe('node scripts/check.js');
  });

  it('数组参数取第一个字符串', () => {
    const d = describeToolAction('read_file', '{"paths":["a.md","b.md"]}');
    expect(d.target).toBe('a.md');
  });

  it('未知工具回退为工具名本身', () => {
    const d = describeToolAction('custom_tool', '{}');
    expect(d.verb).toBe('custom_tool');
    expect(d.target).toBe('');
  });

  it('空工具名回退为“调用工具”', () => {
    expect(describeToolAction('').verb).toBe('调用工具');
  });
});

describe('extractToolTarget / truncateTarget', () => {
  it('无参数返回空串', () => {
    expect(extractToolTarget(undefined)).toBe('');
    expect(extractToolTarget('{}')).toBe('');
    expect(extractToolTarget('not-json')).toBe('');
  });

  it('超长目标截断并保留省略号', () => {
    const long = 'x'.repeat(200);
    const out = truncateTarget(long, 10);
    expect(out.length).toBe(11);
    expect(out.endsWith('…')).toBe(true);
  });
});
