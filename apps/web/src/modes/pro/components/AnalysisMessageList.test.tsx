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
import type { AgentRunData } from '../../../api/agent';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/message', () => ({ feedbackMessage: vi.fn(async () => undefined) }));

const emptyNotice = () => screen.queryByText(/Agent 本轮未产出完整回答/);

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

  /** 展开过程容器（终态默认收起为一行摘要，内部块需先展开才可交互） */
  function expandProcess(): void {
    const header = screen.queryByRole('button', { name: /执行过程/ });
    if (header && header.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(header);
    }
  }

  it('过程容器：终态收成一行摘要、运行中展开（借鉴豆包工作）', () => {
    const streamingMessage = {
      ...taoMessage,
      status: 'streaming' as const,
      content: [
        {
          ...taoMessage.content[0],
          status: 'streaming' as const,
        },
        taoMessage.content[1],
      ],
    };

    const { rerender } = render(
      <AnalysisMessageList status="streaming" messages={[streamingMessage as never]} />,
    );

    // 运行中：容器展开，标题带「运行中」
    const live = screen.getByRole('button', { name: /执行过程/ });
    expect(live).toHaveAttribute('aria-expanded', 'true');
    expect(live.getAttribute('aria-label')).toMatch(/运行中/);

    // 终态：自动收起，摘要为「已完成 · 耗时 X」（不再显示检索/工具次数）
    rerender(<AnalysisMessageList status="complete" messages={[taoMessage as never]} />);
    const done = screen.getByRole('button', { name: /执行过程/ });
    expect(done).toHaveAttribute('aria-expanded', 'false');
    expect(done.getAttribute('aria-label')).toMatch(/^执行过程，已完成 · 耗时 /);
    expect(done.getAttribute('aria-label')).not.toMatch(/次(检索|工具调用)/);
    // 收起态下正文仍在容器之外（只留回答）
    expect(screen.getByText('最终回答')).toBeInTheDocument();
  });

  it('连续同类检索聚合为一行，展开后明细保留完整 query', () => {
    const queries = [
      'HITL agent design best practices 2025 clarification disambiguation',
      'Devin Cursor agent plan confirm apply diff human approval mechanism',
      'LangGraph interrupt human-in-the-loop pattern agent clarification',
    ];
    const batchMessage = {
      id: 'a-batch',
      role: 'assistant' as const,
      status: 'complete' as const,
      content: [
        {
          type: 'reasoning' as const,
          data: [{ type: 'text' as const, data: '先并行检索。', status: 'complete' as const }],
          status: 'complete' as const,
        },
        ...queries.map((q, i) => ({
          type: 'toolcall' as const,
          data: { toolCallId: `t${i}`, toolCallName: 'web_search', args: `{"query":"${q}"}` },
          status: 'complete' as const,
        })),
        { type: 'markdown' as const, data: '最终回答' },
      ],
    };

    render(<AnalysisMessageList status="complete" messages={[batchMessage as never]} />);
    expandProcess();

    // 一轮 3 条检索收成一行人话摘要：收集「<首条关键词>」等 3 条资料
    const batch = screen.getByRole('button', { name: /等 3 条资料/ });
    expect(batch.getAttribute('aria-label')).toMatch(/^收集「HITL agent design best practic/);
    expect(batch).toHaveAttribute('aria-expanded', 'false');
    // 容器摘要不再出现检索次数
    expect(
      screen.getByRole('button', { name: /执行过程/ }).getAttribute('aria-label'),
    ).not.toMatch(/次(检索|工具调用)/);
    // 明细默认收起（收起态不在可访问树里）
    expect(
      screen.queryByRole('button', { name: /Devin Cursor agent plan confirm/ }),
    ).toBeNull();

    fireEvent.click(batch);
    // 明细行保留完整 query（聚合行负责压缩，明细行不做压缩）
    expect(
      screen.getByRole('button', {
        name: /联网搜索 Devin Cursor agent plan confirm apply diff human approval mechanism/,
      }),
    ).toBeInTheDocument();
  });

  it('思考段渲染为“深度思考”折叠块（终态默认收起，可点击展开）', () => {
    render(<AnalysisMessageList status="complete" messages={[taoMessage as never]} />);

    expandProcess();
    const header = screen.getByRole('button', { name: /深度思考/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('先加载技能。')).toBeInTheDocument();
  });

  it('多轮思考均为同一「深度思考」标签（不带轮次编号）', () => {
    const multiRound = {
      id: 'a-multi',
      role: 'assistant' as const,
      status: 'complete' as const,
      content: [
        {
          type: 'reasoning' as const,
          data: [{ type: 'text' as const, data: '第一轮思考。', status: 'complete' as const }],
          status: 'complete' as const,
        },
        {
          type: 'toolcall' as const,
          data: { toolCallId: 't1', toolCallName: 'web_search', args: '{"query":"a"}' },
          status: 'complete' as const,
        },
        {
          type: 'reasoning' as const,
          data: [{ type: 'text' as const, data: '第二轮思考。', status: 'complete' as const }],
          status: 'complete' as const,
        },
        { type: 'markdown' as const, data: '最终回答' },
      ],
    };

    render(<AnalysisMessageList status="complete" messages={[multiRound as never]} />);
    expandProcess();

    // 两段思考各自成块、标题统一为「深度思考」，不带轮次编号
    const headers = screen.getAllByRole('button', { name: '深度思考' });
    expect(headers).toHaveLength(2);

    // 各段内容独立（展开后互不串段）
    headers.forEach((h) => fireEvent.click(h));
    expect(screen.getByText('第一轮思考。')).toBeInTheDocument();
    expect(screen.getByText('第二轮思考。')).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: /开始思考/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('运行阶段交互：准备中 → 开始思考 →（收尾）深度思考并默认收起', () => {
    const messageOf = (phase: string | undefined, streaming: boolean, text: string) => ({
      id: 'a-phase',
      role: 'assistant',
      status: streaming ? 'streaming' : 'complete',
      content: [
        {
          type: 'reasoning',
          data: [{ type: 'text', data: text, status: 'complete' }],
          status: streaming ? 'streaming' : 'complete',
          ext: phase ? { collapsed: false, phase } : { collapsed: false },
        },
      ],
    });

    const { rerender } = render(
      <AnalysisMessageList
        status="streaming"
        messages={[messageOf('preparing', true, '') as never]}
      />,
    );

    // ① Agent 已启动、尚未产出思考内容：出现“准备中”状态行
    expect(screen.getByRole('button', { name: /准备中/ })).toBeInTheDocument();

    // ② THINKING_START 后同一块提升：标题切换为“开始思考”，内容实时可见
    rerender(
      <AnalysisMessageList
        status="streaming"
        messages={[messageOf('thinking', true, '正在分析…') as never]}
      />,
    );
    expect(screen.getByRole('button', { name: /开始思考/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('正在分析…')).toBeInTheDocument();

    // ③ 思考收尾：标题回到“深度思考”，并自动收起（默认关闭态）
    rerender(
      <AnalysisMessageList
        status="complete"
        messages={[messageOf(undefined, false, '正在分析…') as never]}
      />,
    );
    // 终态过程容器同步收起：先展开容器，再断言思考块自身为收起态
    expandProcess();
    expect(screen.getByRole('button', { name: /深度思考/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('工具调用渲染为一行式动作摘要，展开可见参数与观察（截图交互）', () => {
    render(<AnalysisMessageList status="complete" messages={[taoMessage as never]} />);

    expandProcess();
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
            toolCallName: 'web_search',
            args: '{"query":"Harness Engineering"}',
            result: JSON.stringify({
              tool: 'web_search',
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

    expandProcess();
    // 动作行摘要（语义压缩）：联网搜索「关键词」· 参考 N 篇
    const row = screen.getByRole('button', {
      name: /联网搜索「Harness Engineering」\s*·\s*参考 2 篇/,
    });
    fireEvent.click(row);

    // 来源列表：标题可点开原文 + 全部条数概要
    const link = screen.getByRole('link', { name: /Harness Engineering 定义/ });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(screen.getByText('上下文工程实践')).toBeInTheDocument();
    expect(screen.getByText('bing · 共 2 篇来源')).toBeInTheDocument();

    // 原始数据默认收起，点击后可展开追溯
    const rawToggle = screen.getByRole('button', { name: /原始数据/ });
    expect(rawToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(rawToggle);
    expect(rawToggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('过程收进容器、回答留在容器外；容器内仍是思考/行动交错顺序', () => {
    const { container } = render(
      <AnalysisMessageList status="complete" messages={[taoMessage as never]} />,
    );

    // 顶层：过程容器 + 回答正文（排除操作栏 / 执行轨迹）
    const body = container.querySelector('.chat-msg-ai-body')!;
    const topClasses = Array.from(body.children)
      .map((n) =>
        n.classList.contains('tao-process')
          ? 'process'
          : n.classList.contains('chat-markdown')
            ? 'text'
            : 'other',
      )
      .filter((c) => c !== 'other');
    expect(topClasses).toEqual(['process', 'text']);

    // 容器内：TAO 块按事件顺序交错（思考 → 行动）
    expandProcess();
    const inner = body.querySelector('.tao-process-body')!;
    const innerClasses = Array.from(inner.children)
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
    expect(innerClasses).toEqual(['reasoning', 'tool']);
  });

  it('有 run 时：操作栏常驻（has-run-trace），轨迹胶囊位于操作栏行内', () => {
    const run: AgentRunData = {
      id: 'run-1',
      sessionId: 's1',
      messageId: 'a-tao',
      agentMode: 'react_agent',
      status: 'completed',
      traceId: 'run-1',
      events: [{ seq: 1, type: 'RUN_FINISHED', ts: 1 }],
      usage: null,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(0).toISOString(),
      endedAt: null,
      durationMs: 100,
    };
    const { container } = render(
      <AnalysisMessageList
        status="complete"
        messages={[taoMessage as never]}
        runByMessage={new Map([['a-tao', run]])}
      />,
    );

    const bar = container.querySelector('.chat-action-bar')!;
    expect(bar).toHaveClass('has-run-trace');
    expect(bar.querySelector('.run-trace')).not.toBeNull();
    expect(screen.getByText('执行轨迹')).toBeInTheDocument();
  });

  it('无 run 时：操作栏保持 hover 显隐（无 has-run-trace），不渲染轨迹胶囊', () => {
    const { container } = render(
      <AnalysisMessageList status="complete" messages={[taoMessage as never]} />,
    );

    const bar = container.querySelector('.chat-action-bar')!;
    expect(bar).not.toHaveClass('has-run-trace');
    expect(bar.querySelector('.run-trace')).toBeNull();
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

  it('助手操作栏包含重新生成按钮（警示 tooltip），点击回调携带消息 id', () => {
    const onRegenerate = vi.fn();
    render(
      <AnalysisMessageList
        status="complete"
        messages={[
          { id: 'u1', role: 'user' as const, content: [{ type: 'text' as const, data: '你好' }] },
          {
            id: 'a1',
            role: 'assistant' as const,
            status: 'complete',
            content: [{ type: 'markdown' as const, data: '回复正文' }],
          },
        ]}
        onRegenerate={onRegenerate}
      />,
    );

    const btn = screen.getByRole('button', { name: '重新生成' });
    expect(btn).toHaveAttribute(
      'data-tooltip',
      '点击将重新生成会话和产物，请谨慎操作',
    );
    fireEvent.click(btn);
    expect(onRegenerate).toHaveBeenCalledWith('a1');
  });

  it('run 带 usage 时操作栏展示 token 用量，无 usage 时不展示', () => {
    const run = {
      id: 'run-1',
      sessionId: 's1',
      messageId: 'a1',
      agentMode: 'react_agent',
      status: 'completed',
      traceId: 'run-1',
      events: [],
      usage: { promptTokens: 1200, completionTokens: 234 },
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(0).toISOString(),
      endedAt: null,
      durationMs: 100,
    } as AgentRunData;
    const messages = [
      {
        id: 'a1',
        role: 'assistant' as const,
        status: 'complete' as const,
        content: [{ type: 'markdown' as const, data: '回复正文' }],
      },
    ];

    const { container, rerender } = render(
      <AnalysisMessageList
        status="complete"
        messages={messages}
        runByMessage={new Map([['a1', run]])}
      />,
    );
    expect(container.querySelector('.chat-action-tokens')).toHaveTextContent(
      '1,434 tokens',
    );

    rerender(
      <AnalysisMessageList
        status="complete"
        messages={messages}
        runByMessage={new Map([['a1', { ...run, usage: null } as never]])}
      />,
    );
    expect(container.querySelector('.chat-action-tokens')).toBeNull();
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

/**
 * 「本轮未产出完整回答」回归（缺陷：工具轮次触顶被中止）
 *
 * 真实事故：agent 在工具轮次上限处被强制终止，消息里只有若干过程叙述
 * （"我先去核实一下…"），最后一段还没带 narration 标记 → 前端把它当正文渲染，
 * 用户看到的"回答"只有一句话。本组锁定两道防线：
 *   1) 只有过程叙述、没有真实回答时，回答区给出可见提示；
 *   2) 没等到观测结果的工具调用显示「未执行」，不再假装执行中/已完成。
 */
describe('AnalysisMessageList — 未产出完整回答与未执行动作行', () => {
  function expandProcess(): void {
    const header = screen.queryByRole('button', { name: /执行过程/ });
    if (header && header.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(header);
    }
  }

  it('只有过程叙述、没有最终回答 → 回答区显示提示，叙述收在过程容器里', () => {
    render(
      <AnalysisMessageList
        status="complete"
        messages={[
          {
            id: 'a-narration-only',
            role: 'assistant',
            status: 'complete',
            content: [
              {
                type: 'reasoning',
                data: [{ type: 'text', data: '先检索。', status: 'complete' }],
                status: 'complete',
              },
              {
                type: 'markdown',
                data: '我先去核实一下业界实践的公开资料。',
                ext: { narration: true },
                status: 'complete',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText(/Agent 本轮未产出完整回答/)).toBeInTheDocument();
    expandProcess();
    // 叙述句属于过程信息，收在容器内（不会显示成正文）
    expect(screen.getByText('我先去核实一下业界实践的公开资料。')).toBeInTheDocument();
  });

  it('未执行的动作行标注「未执行」（触顶/中止后不再显示为执行中）', () => {
    render(
      <AnalysisMessageList
        status="complete"
        messages={[
          {
            id: 'a-aborted-tool',
            role: 'assistant',
            status: 'complete',
            content: [
              {
                type: 'toolcall',
                data: {
                  toolCallId: 't1',
                  toolCallName: 'web_search',
                  args: '{"query":"HITL 澄清"}',
                },
                status: 'stop',
              },
            ],
          },
        ]}
      />,
    );

    expandProcess();
    expect(
      screen.getByRole('button', { name: /联网搜索.*未执行/ }),
    ).toBeInTheDocument();
  });
});
