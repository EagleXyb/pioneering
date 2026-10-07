/**
 * usePlanExecuteChat —— HITL 全序列测试（T1.4 验收）
 *
 * 验证：暂停入队 + plan store 互斥、批准续写同一条消息、
 * 澄清回答透传、暂停守卫、暂停态 abort。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const clientMocks = vi.hoisted(() => ({
  post: vi.fn(async () => undefined),
  get: vi.fn(async () => null),
}));

vi.mock('../../../api/client', () => ({
  getAuthHeader: () => ({}),
  get: clientMocks.get,
  post: clientMocks.post,
}));

// getMessages / plan 快照在 HITL 序列中不使用（loadHistory 不在本测试路径）
vi.mock('../../../api/message', () => ({
  getMessages: vi.fn(async () => ({ messages: [] })),
}));
vi.mock('../../../api/plan', () => ({
  getMessagePlan: vi.fn(async () => ({ steps: [] })),
  patchCollapsedSteps: vi.fn(async () => undefined),
}));

import { usePlanExecuteChat } from './usePlanExecuteChat';
import { useHitlStore } from '@pioneering/agent-protocol';
import { usePlanExecuteStore } from '../../../store/planExecuteStore';

function sseResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const evt of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n`));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

let completionsEvents: object[] = [];
let resumeEvents: object[] = [];
const resumeBodies: Array<Record<string, unknown>> = [];

describe('usePlanExecuteChat — HITL 全链路', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useHitlStore.getState().reset();
    usePlanExecuteStore.getState().reset();
    resumeBodies.length = 0;
    clientMocks.post.mockClear();

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/agent/completions') return sseResponse(completionsEvents);
        if (url === '/api/agent/resume') {
          resumeBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return sseResponse(resumeEvents);
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
  });

  afterEach(() => {
    useHitlStore.getState().reset();
    usePlanExecuteStore.getState().reset();
  });

  it('tool_confirm：暂停入队并锁定 plan，批准后续写同一条消息', async () => {
    completionsEvents = [
      {
        type: 'STATE_DELTA',
        phase: 'plan',
        plan: [{ step_id: 's1', title: '步骤1', description: 'D', status: 'pending' }],
      },
      { type: 'TEXT_MESSAGE_CONTENT', delta: '准备执行' },
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'tool_confirm',
        session_id: 'session-1',
        tool_calls: [{ id: 'c1', name: 'code_executor', args: { cmd: 'ls' } }],
      },
      { type: 'RUN_PAUSED' },
    ];
    resumeEvents = [
      {
        type: 'STATE_DELTA',
        phase: 'execute',
        step_update: { id: 's1', status: 'done', result: 'ok' },
      },
      { type: 'TEXT_MESSAGE_CONTENT', delta: '完成' },
      { type: 'RUN_FINISHED' },
    ];

    const { result } = renderHook(() => usePlanExecuteChat('session-1'));
    // sendMessage 为 async：用 async act 完整等待至暂停，避免更新泄漏
    await act(async () => {
      await result.current.sendMessage({ prompt: '执行 ls' });
    });

    await waitFor(() => expect(result.current.hitl?.kind).toBe('tool_confirm'));
    expect(usePlanExecuteStore.getState().hitlLocked).toBe(true);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]!.content![0]).toMatchObject({
      type: 'text',
      data: '准备执行',
    });

    // 直接触发（不包 act，避免内部 spawn 的 resume 流逃出 act 破坏环境），
    // waitFor 轮询自带 act 刷新
    void useHitlStore.getState().resolve({ approved: true });
    await waitFor(() => expect(result.current.hitl).toBeNull());
    expect(resumeBodies[0]).toMatchObject({ approved: true, modifiedArgs: null });

    expect(usePlanExecuteStore.getState().hitlLocked).toBe(false);
    expect(usePlanExecuteStore.getState().phase).toBe('done')

    // 续写同一条 assistant 消息
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1]!.content![0]).toMatchObject({
      type: 'text',
      data: '准备执行完成',
    })
  })

  it('clarifying：回答透传 answer', async () => {
    completionsEvents = [
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'clarifying',
        session_id: 'session-1',
        question: '你想做什么？',
      },
      { type: 'RUN_PAUSED' },
    ]
    resumeEvents = [{ type: 'RUN_FINISHED' }]

    const { result } = renderHook(() => usePlanExecuteChat('session-1'))
    await act(async () => {
      await result.current.sendMessage({ prompt: '帮我弄一下' })
    })

    await waitFor(() => expect(result.current.hitl?.kind).toBe('clarifying'))
    void useHitlStore
      .getState()
      .resolve({ approved: true, answer: '季度报告', feedback: '季度报告' })

    await waitFor(() => expect(result.current.hitl).toBeNull())
    expect(resumeBodies[0]).toMatchObject({ approved: true, answer: '季度报告' })
  })

  it('暂停守卫：paused 时不能发起新请求', async () => {
    completionsEvents = [
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'clarifying',
        session_id: 'session-1',
        question: 'q',
      },
      { type: 'RUN_PAUSED' },
    ]

    const fetchSpy = vi.mocked(globalThis.fetch)
    const { result } = renderHook(() => usePlanExecuteChat('session-1'))
    await act(async () => {
      await result.current.sendMessage({ prompt: 'first' })
    })

    await waitFor(() => expect(result.current.hitl).not.toBeNull())
    await act(async () => {
      await result.current.sendMessage({ prompt: 'second' })
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(resumeBodies).toHaveLength(0)
  })

  it('暂停态 abort：调 /agent/abort', async () => {
    completionsEvents = [
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'tool_confirm',
        session_id: 'session-1',
        tool_calls: [{ id: 'c1', name: 'code_executor', args: {} }],
      },
      { type: 'RUN_PAUSED' },
    ]

    const { result } = renderHook(() => usePlanExecuteChat('session-1'))
    await act(async () => {
      await result.current.sendMessage({ prompt: '执行' })
    })

    await waitFor(() => expect(result.current.hitl).not.toBeNull())
    act(() => result.current.abort())

    await waitFor(() => expect(clientMocks.post).toHaveBeenCalled())
    expect(clientMocks.post).toHaveBeenCalledWith(
      '/agent/abort',
      expect.objectContaining({ sessionId: 'session-1', reason: 'user_cancel' }),
    )
  })
})
