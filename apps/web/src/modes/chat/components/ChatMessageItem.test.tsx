/**
 * ChatMessageItem —— 助手消息操作栏测试
 *
 * 锁定：五个操作按钮（复制/赞/踩/分享/重新生成）统一使用自定义悬停提示
 * （`data-tooltip` + `chat-tooltip`），不得回退为原生 `title`。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/api/message', async () => {
  const actual = await vi.importActual<typeof import('@/api/message')>('@/api/message');
  return { ...actual, feedbackMessage: vi.fn(async () => undefined) };
});

import { ChatMessageItem } from './ChatMessageItem';
import type { ChatMessageData } from '@/api/converter';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function assistantMessage(): ChatMessageData {
  return {
    id: 'msg_a1',
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'markdown', data: '这是回复正文' }],
  } as ChatMessageData;
}

describe('ChatMessageItem — 助手操作栏悬停提示', () => {
  it('五个操作按钮均带 data-tooltip 与 chat-tooltip，且无原生 title', () => {
    const { container } = render(<ChatMessageItem message={assistantMessage()} />);

    const labels = ['复制', '赞', '踩', '分享', '重新生成'];
    for (const label of labels) {
      const btn = screen.getByRole('button', { name: label });
      expect(btn).toHaveClass('chat-tooltip');
      expect(btn).toHaveAttribute('data-tooltip', label);
      expect(btn).not.toHaveAttribute('title');
    }
    // 组件内不应残留任何原生 title 提示
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('流式中的消息不渲染操作栏（无终态）', () => {
    const streaming = {
      ...assistantMessage(),
      status: 'streaming',
    } as ChatMessageData;
    render(<ChatMessageItem message={streaming} />);
    expect(screen.queryByRole('toolbar', { name: '消息操作' })).toBeNull();
  });
});
