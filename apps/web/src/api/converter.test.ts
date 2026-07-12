/**
 * convertMessages 单元测试
 * 验证后端 Message → TDesign ChatMessagesData 转换逻辑
 */
import { describe, it, expect } from 'vitest';
import { convertMessages } from './converter';
import type { Message } from './types';

describe('convertMessages', () => {
  it('过滤 system 角色消息，仅保留 user / assistant', () => {
    const messages: Message[] = [
      { id: '1', role: 'system', content: 'system prompt', createdAt: '', updatedAt: '' } as Message,
      { id: '2', role: 'user', content: 'hello', createdAt: '', updatedAt: '' } as Message,
      { id: '3', role: 'assistant', content: 'hi', createdAt: '', updatedAt: '' } as Message,
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('3');
  });

  it('正确转换 user 消息为 text content', () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: '你好世界',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as Message,
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toHaveLength(1);
    expect(result[0].content![0].type).toBe('text');
    expect(result[0].content![0].data).toBe('你好世界');
  });

  it('正确转换 assistant 消息（无 reasoning）为 markdown content', () => {
    const messages: Message[] = [
      {
        id: 'a1',
        sessionId: 's1',
        role: 'assistant',
        content: '这是回答',
        contentBlocks: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as Message,
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    // 无 reasoning 时仅有 1 个 markdown block
    expect(result[0].content).toHaveLength(1);
    expect(result[0].content![0].type).toBe('markdown');
    expect(result[0].content![0].data).toBe('这是回答');
  });

  it('正确提取 assistant 消息的 reasoningContent', () => {
    const messages: Message[] = [
      {
        id: 'a2',
        role: 'assistant',
        content: '最终回答',
        contentBlocks: [
          { type: 'text', reasoningContent: '思考过程...' },
        ],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as any,
    ];
    const result = convertMessages(messages);
    expect(result[0].content).toHaveLength(2);
    // 第一个 block 是 reasoning
    expect(result[0].content![0].type).toBe('reasoning');
    // 第二个 block 是 markdown
    expect(result[0].content![1].type).toBe('markdown');
    expect(result[0].content![1].data).toBe('最终回答');
  });

  it('空数组返回空数组', () => {
    expect(convertMessages([])).toEqual([]);
  });
});
