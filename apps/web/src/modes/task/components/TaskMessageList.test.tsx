/**
 * TaskMessageList 集成测试
 *
 * 验证重构后的关键行为：
 *   1. 每条消息外层暴露 data-message-id 属性（反向联动定位基础）
 *   2. assistant 消息中的 ```html 代码块显示"预览"按钮
 *   3. 点击预览按钮触发 openArtifact，正确携带 messageId
 *   4. user 消息中的代码块不显示预览按钮（业务约束）
 *   5. 无代码块的消息走原渲染路径（保留原有行为）
 *   6. 空消息列表显示空态
 *   7. streaming 状态显示思考指示器
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { TaskMessageList } from './TaskMessageList';
import { useArtifactStore } from '@/store/artifactStore';
import type { ChatMessagesData } from '@/types/tdesign';

// 构造消息的辅助函数
function makeMessage(over: Partial<ChatMessagesData> & { id: string; role: 'user' | 'assistant' }): ChatMessagesData {
  return {
    content: [],
    datetime: new Date().toISOString(),
    ...over,
  } as ChatMessagesData;
}

describe('TaskMessageList', () => {
  beforeEach(() => {
    useArtifactStore.getState().reset();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    useArtifactStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('每条消息外层暴露 data-message-id', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: [{ type: 'text', data: 'hi' }] as any }),
      makeMessage({ id: 'a1', role: 'assistant', content: [{ type: 'markdown', data: 'hello' }] as any }),
    ];
    const { container } = render(<TaskMessageList messages={messages} status="idle" />);

    const u1 = container.querySelector('[data-message-id="u1"]');
    const a1 = container.querySelector('[data-message-id="a1"]');
    expect(u1).not.toBeNull();
    expect(a1).not.toBeNull();
  });

  it('assistant 消息中的 html 代码块显示"预览"按钮', () => {
    const messages = [
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: [{
          type: 'markdown',
          data: '```html\n<div>test</div>\n```',
        }] as any,
      }),
    ];
    render(<TaskMessageList messages={messages} status="idle" />);

    expect(screen.getByText('预览')).toBeInTheDocument();
  });

  it('点击预览按钮触发 openArtifact 并携带 messageId', () => {
    const messages = [
      makeMessage({
        id: 'msg-html',
        role: 'assistant',
        content: [{
          type: 'markdown',
          data: '```html\n<div>test</div>\n```',
        }] as any,
      }),
    ];
    render(<TaskMessageList messages={messages} status="idle" />);

    fireEvent.click(screen.getByText('预览'));

    const { activeArtifact } = useArtifactStore.getState();
    expect(activeArtifact).not.toBeNull();
    expect(activeArtifact!.messageId).toBe('msg-html');
    expect(activeArtifact!.type).toBe('html');
    expect(activeArtifact!.content).toBe('<div>test</div>');
  });

  it('user 消息中的 html 代码块不显示预览按钮', () => {
    const messages = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: [{
          type: 'text',
          data: '```html\n<div>user code</div>\n```',
        }] as any,
      }),
    ];
    render(<TaskMessageList messages={messages} status="idle" />);

    // user 消息走纯文本路径，不识别代码块，无预览按钮
    expect(screen.queryByText('预览')).toBeNull();
  });

  it('无代码块的 assistant 消息走原渲染路径（纯文本）', () => {
    const messages = [
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'markdown', data: '这是普通文本' }] as any,
      }),
    ];
    const { container } = render(<TaskMessageList messages={messages} status="idle" />);

    expect(container.textContent).toContain('这是普通文本');
    // 不应有代码块卡片
    expect(container.querySelector('.task-code-block')).toBeNull();
  });

  it('空消息列表显示空态', () => {
    const { container } = render(<TaskMessageList messages={[]} status="idle" />);
    expect(container.querySelector('.task-messages-empty')).not.toBeNull();
  });

  it('streaming 状态显示思考指示器', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: [{ type: 'text', data: 'hi' }] as any }),
    ];
    const { container } = render(<TaskMessageList messages={messages} status="streaming" />);

    expect(container.querySelector('.task-thinking-indicator')).not.toBeNull();
  });

  it('非 html/svg 语言的代码块不显示预览按钮但显示代码块卡片', () => {
    const messages = [
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: [{
          type: 'markdown',
          data: '```python\nprint(1)\n```',
        }] as any,
      }),
    ];
    const { container } = render(<TaskMessageList messages={messages} status="idle" />);

    // python 代码块仍以卡片形式展示，但无预览按钮
    expect(container.querySelector('.task-code-block')).not.toBeNull();
    expect(screen.queryByText('预览')).toBeNull();
  });

  it('一条 assistant 消息中混合多个代码块', () => {
    const messages = [
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: [{
          type: 'markdown',
          data: '前文\n```html\n<div></div>\n```\n中间\n```svg\n<svg></svg>\n```',
        }] as any,
      }),
    ];
    const { container } = render(<TaskMessageList messages={messages} status="idle" />);

    // 应有两个代码块卡片，两个预览按钮
    const blocks = container.querySelectorAll('.task-code-block');
    expect(blocks).toHaveLength(2);
    expect(screen.getAllByText('预览')).toHaveLength(2);
  });
});
