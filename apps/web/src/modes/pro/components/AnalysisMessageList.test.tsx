/**
 * AnalysisMessageList —— 空回复兜底回归测试
 *
 * 缺陷：run 正常结束（status='complete'）但正文为空时，原实现渲染 `null`，
 * 整条助手消息在界面上完全消失 —— 用户无法区分「Agent 没回复」与「页面坏了」
 * （真实触发：后端 max_tokens 截断导致 finish_reason='length' 且 content=''，
 *  且此时后端不会发 RUN_ERROR）。
 *
 * 本测试锁定：空终态消息必须给出可见提示；HITL 占位消息（无 status）不误报。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisMessageList } from './AnalysisMessageList';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/message', () => ({ feedbackMessage: vi.fn(async () => undefined) }));

const emptyNotice = () => screen.queryByText(/Agent 本轮未返回内容/);

beforeEach(() => {
  vi.clearAllMocks();
});

// jsdom 未实现 scrollIntoView（自动滚动哨兵会调用）
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('AnalysisMessageList 空回复兜底', () => {
  it('status=complete 且正文为空时，显示可见提示而非空白', () => {
    render(
      <AnalysisMessageList
        status="complete"
        messages={[
          { id: 'u1', role: 'user', content: [{ type: 'text', data: '你好' }] },
          {
            id: 'a1',
            role: 'assistant',
            status: 'complete',
            content: [{ type: 'markdown', data: '' }],
          },
        ]}
      />,
    );

    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(emptyNotice()).toBeInTheDocument();
  });

  it('流式中（status=streaming）不显示空回复提示，仍显示流式占位', () => {
    render(
      <AnalysisMessageList
        status="streaming"
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            status: 'streaming',
            content: [{ type: 'markdown', data: '' }],
          },
        ]}
      />,
    );

    expect(emptyNotice()).toBeNull();
    expect(document.querySelector('.chat-streaming-placeholder')).toBeInTheDocument();
  });

  it('正常有正文时不显示空回复提示', () => {
    render(
      <AnalysisMessageList
        status="complete"
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            status: 'complete',
            content: [{ type: 'markdown', data: '这是正常回复' }],
          },
        ]}
      />,
    );

    expect(screen.getByText('这是正常回复')).toBeInTheDocument();
    expect(emptyNotice()).toBeNull();
  });

  it('HITL 占位消息（无 status、内容为空）不误报空回复', () => {
    render(
      <AnalysisMessageList
        status="complete"
        messages={[
          { id: 'assistant-hitl-s1', role: 'assistant', content: [{ type: 'markdown', data: '' }] },
        ]}
      />,
    );

    expect(emptyNotice()).toBeNull();
  });
});