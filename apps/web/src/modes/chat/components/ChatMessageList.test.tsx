/**
 * ChatMessageList —— 回到底部悬浮按钮
 *
 * 锁定：离开底部（底部哨兵不可见）时按钮浮现，点击后平滑滚回底部；
 * 贴底时隐藏且保持 inert（不进入无障碍树、不拦截消息内容交互）。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ChatMessageData } from '@/api/converter';
import { ChatMessageList } from './ChatMessageList';

type IOCallback = (
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver,
) => void;

/** 捕获组件创建的 IntersectionObserver 回调，手动模拟哨兵可见性变化 */
const ioCallbacks: IOCallback[] = [];

class MockIntersectionObserver {
  constructor(cb: IOCallback) {
    ioCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const scrollIntoView = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

beforeEach(() => {
  ioCallbacks.length = 0;
  scrollIntoView.mockClear();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

function aiMessage(): ChatMessageData {
  return {
    id: 'msg_a1',
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'markdown', data: '回复正文' }],
  } as ChatMessageData;
}

/** 模拟底部哨兵可见性（false = 用户已离开底部） */
function emitBottomSentinel(visible: boolean) {
  act(() => {
    ioCallbacks.forEach((cb) =>
      cb([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver),
    );
  });
}

describe('ChatMessageList — 回到底部按钮', () => {
  it('贴底时隐藏，离开底部后浮现', () => {
    const { container } = render(
      <ChatMessageList messages={[aiMessage()]} status="complete" />,
    );
    const wrap = container.querySelector('.chat-scroll-bottom');
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveClass('chat-scroll-bottom');
    expect(wrap).not.toHaveClass('is-visible');
    expect(wrap).toHaveAttribute('aria-hidden', 'true');

    emitBottomSentinel(false);
    expect(wrap).toHaveClass('is-visible');
    expect(wrap).toHaveAttribute('aria-hidden', 'false');
  });

  it('点击按钮平滑滚回底部', () => {
    render(<ChatMessageList messages={[aiMessage()]} status="complete" />);
    emitBottomSentinel(false);

    fireEvent.click(screen.getByRole('button', { name: '回到底部' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('空列表挂载后再到位消息：底部哨兵监听会重建（按钮显隐不失效）', () => {
    const { container, rerender } = render(<ChatMessageList messages={[]} status="idle" />);
    // 空态时不建立监听
    expect(ioCallbacks).toHaveLength(0);

    rerender(<ChatMessageList messages={[aiMessage()]} status="complete" />);
    // 消息到位后必须重建监听，否则近底部判定与按钮显隐永久失效
    expect(ioCallbacks).toHaveLength(1);

    emitBottomSentinel(false);
    expect(container.querySelector('.chat-scroll-bottom')).toHaveClass('is-visible');
  });
});
