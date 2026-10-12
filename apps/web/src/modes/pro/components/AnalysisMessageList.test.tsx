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
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('AnalysisMessageList TAO 闭环（推理-行动-观察）', () => {
  const taoMessage = {
    id: 'a-tao',
    role: 'assistant' as const,
    status: 'complete' as const,
    content: [
      {
        type: 'reasoning' as const,
        data: [{ type: 'text' as const, data: '先加载技能。', status: 'complete' as const }],
        status: 'complete' as const,
        ext: { collapsed: false },
      },
      {
        type: 'toolcall' as const,
        data: {
          toolCallId: 't1',
          toolCallName: 'library',
          args: '{"skill":"library"}',
          result: '{"ok":true}',
        },
        status: 'complete' as const,
        ext: { collapsed: true },
      },
      { type: 'markdown' as const, data: '最终回答' },
    ],
  };

  it('思考段渲染为“深度思考”折叠块（终态默认收起，可点击展开）', () => {
    render(<AnalysisMessageList status="complete" messages={[taoMessage as never]} />);

    const header = screen.getByRole('button', { name: /深度思考/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('先加载技能。')).toBeInTheDocument();
  });

  it('流式思考段默认展开（用户可实时看到推理推进）', () => {
    render(
      <AnalysisMessageList
        status="streaming"
        messages={[
          {
            id: 'a-stream',
            role: 'assistant',
            status: 'streaming',
            content: [
              {
                type: 'reasoning',
                data: [{ type: 'text', data: '推理中…', status: 'complete' }],
                status: 'streaming',
              },
            ],
          } as never,
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: /深度思考/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('工具调用渲染为一行式动作摘要，展开可见参数与观察（截图交互）', () => {
    render(<AnalysisMessageList status="complete" messages={[taoMessage as never]} />);

    // 默认只有一行摘要：动词 + 目标对象
    const toolRow = screen.getByRole('button', { name: /加载技能/ });
    expect(toolRow).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('参数')).toBeNull();

    fireEvent.click(toolRow);
    expect(toolRow).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('参数')).toBeInTheDocument();
    expect(screen.getByText('观察')).toBeInTheDocument();
  });

  it('联网搜索观测展开为来源卡片（WorkBuddy 风格），原始数据可追溯', () => {
    const searchMessage = {
      id: 'a-search',
      role: 'assistant' as const,
      status: 'complete' as const,
      content: [
        {
          type: 'toolcall' as const,
          data: {
            toolCallId: 't2',
            toolCallName: 'search_engine',
            args: '{"query":"Harness Engineering"}',
            result: JSON.stringify({
              tool: 'search_engine',
              status: 'success',
              data: {
                results: [
                  { title: 'Harness Engineering 定义', url: 'https://example.com/a', source: 'bing' },
                  { title: '上下文工程实践', url: 'https://example.org/b', source: 'bing' },
                ],
                source: 'bing',
              },
            }),
          },
          status: 'complete' as const,
          ext: { collapsed: true },
        },
      ],
    };

    render(<AnalysisMessageList status="complete" messages={[searchMessage as never]} />);

    // 动作行摘要：动词（联网搜索）+ 目标对象
    const row = screen.getByRole('button', { name: /联网搜索 Harness Engineering/ });
    fireEvent.click(row);

    // 来源列表：标题可点开原文 + 引擎来源信息
    const link = screen.getByRole('link', { name: /Harness Engineering 定义/ });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(screen.getByText('上下文工程实践')).toBeInTheDocument();
    expect(screen.getByText('来源：bing')).toBeInTheDocument();

    // 原始数据默认收起，点击后可展开追溯
    const rawToggle = screen.getByRole('button', { name: /原始数据/ });
    expect(rawToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(rawToggle);
    expect(rawToggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('同一消息内思考/行动/正文按块顺序交错渲染', () => {
    const { container } = render(
      <AnalysisMessageList status="complete" messages={[taoMessage as never]} />,
    );

    // 只看消息主体的顶层子节点（排除操作栏 / 执行轨迹）
    const body = container.querySelector('.chat-msg-ai-body')!;
    const classes = Array.from(body.children)
      .map((n) =>
        n.classList.contains('tao-reasoning')
          ? 'reasoning'
          : n.classList.contains('tao-tool')
            ? 'tool'
            : n.classList.contains('chat-markdown')
              ? 'text'
              : 'other',
      )
      .filter((c) => c !== 'other');
    expect(classes).toEqual(['reasoning', 'tool', 'text']);
  });
});

describe('AnalysisMessageList 用户消息气泡（与 chat / task 对齐）', () => {
  const userMsg = { id: 'u1', role: 'user' as const, content: [{ type: 'text' as const, data: '你好' }] };

  it('渲染悬停元信息行与复制入口', () => {
    const { container } = render(
      <AnalysisMessageList status="complete" messages={[userMsg]} />,
    );

    expect(container.querySelector('.chat-user-meta')).not.toBeNull();
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
  });

  it('canEditUserMessage=true 时出现编辑入口并回调 onStartEdit', () => {
    const onStartEdit = vi.fn();
    render(
      <AnalysisMessageList
        status="complete"
        messages={[userMsg]}
        canEditUserMessage
        onStartEdit={onStartEdit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(onStartEdit).toHaveBeenCalledWith('u1');
  });

  it('助手操作栏按钮统一使用 data-tooltip（无原生 title）', () => {
    const { container } = render(
      <AnalysisMessageList
        status="complete"
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            status: 'complete',
            content: [{ type: 'markdown', data: '回复正文' }],
          },
        ]}
      />,
    );

    for (const label of ['复制', '赞', '踩', '分享']) {
      const btn = screen.getByRole('button', { name: label });
      expect(btn).toHaveClass('chat-tooltip');
      expect(btn).toHaveAttribute('data-tooltip', label);
      expect(btn).not.toHaveAttribute('title');
    }
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('editingMessageId 命中时进入编辑态并提交新文本', () => {
    const onSubmitEdit = vi.fn();
    render(
      <AnalysisMessageList
        status="complete"
        messages={[userMsg]}
        canEditUserMessage
        editingMessageId="u1"
        onSubmitEdit={onSubmitEdit}
        onCancelEdit={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText('编辑消息');
    fireEvent.change(textarea, { target: { value: '改后的内容' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    expect(onSubmitEdit).toHaveBeenCalledWith('u1', '改后的内容');
  });
});