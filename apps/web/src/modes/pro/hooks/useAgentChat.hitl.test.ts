/**
 * useAgentChat —— HITL 全序列测试（T1.3 验收）
 *
 * mock 两段 SSE：completions 流（文本 → 中断请求 → 暂停）与 resume 流
 *（续写文本 → 完成），验证：
 *   1. tool_confirm 批准后续写同一条 assistant 消息（条数不变）
 *   2. clarifying 回答透传 answer
 *   3. choice 透传 answerId
 *   4. reject 透传 approved=false + feedback
 *   5. 暂停守卫：paused 时不能发起新请求
 *   6. 暂停态 abort → 调 /agent/abort
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

import { useAgentChat } from './useAgentChat';
import { useHitlStore } from '@pioneering/agent-protocol';

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

describe('useAgentChat — HITL 全链路', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useHitlStore.getState().reset();
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

  afterEach(() => useHitlStore.getState().reset());

  it('tool_confirm：暂停展示卡片，批准后续写同一条消息', async () => {
    completionsEvents = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: '分析中…' },
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'tool_confirm',
        session_id: 'session-1',
        tool_calls: [{ id: 'c1', name: 'code_executor', args: { cmd: 'ls' } }],
      },
      { type: 'RUN_PAUSED' },
    ];
    resumeEvents = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: '执行完成' },
      { type: 'RUN_FINISHED' },
    ];

    const { result } = renderHook(() => useAgentChat('session-1', false));
    act(() => result.current.sendMessage({ prompt: '执行 ls' }));

    await waitFor(() => expect(result.current.hitl?.kind).toBe('tool_confirm'));
    expect(result.current.status).toBe('complete');
    expect(result.current.messages).toHaveLength(2);
    const assistantContent = result.current.messages[1]!.content!;
    expect(assistantContent[0]).toMatchObject({ type: 'markdown', data: '分析中…' });

    await act(async () => {
      const ok = await useHitlStore.getState().resolve({ approved: true });
      expect(ok).toBe(true);
    });

    expect(resumeBodies[0]).toMatchObject({ approved: true, modifiedArgs: null });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    // 续写同一条消息：条数不变、内容拼接
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]!.content![0]).toMatchObject({
      type: 'markdown',
      data: '分析中…执行完成',
    });
    expect(result.current.hitl).toBeNull();
  });

  it('clarifying：回答透传 answer/feedback 后续写', async () => {
    completionsEvents = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: '嗯…' },
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'clarifying',
        session_id: 'session-1',
        question: '你想做什么？',
      },
      { type: 'RUN_PAUSED' },
    ];
    resumeEvents = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: '好的' },
      { type: 'RUN_FINISHED' },
    ];

    const { result } = renderHook(() => useAgentChat('session-1', false));
    act(() => result.current.sendMessage({ prompt: '帮我弄一下' }));

    await waitFor(() => expect(result.current.hitl?.kind).toBe('clarifying'));
    expect(result.current.hitl?.question).toBe('你想做什么？');

    await act(async () => {
      await useHitlStore
        .getState()
        .resolve({ approved: true, answer: '季度报告', feedback: '季度报告' });
    });

    expect(resumeBodies[0]).toMatchObject({
      approved: true,
      answer: '季度报告',
      feedback: '季度报告',
    });

    await waitFor(() => expect(result.current.hitl).toBeNull());
  });

  it('choice：点选项透传 answerId', async () => {
    completionsEvents = [
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'choice',
        session_id: 'session-1',
        options: [{ id: 'o1', label: '网页' }],
      },
      { type: 'RUN_PAUSED' },
    ];
    resumeEvents = [{ type: 'RUN_FINISHED' }];

    const { result } = renderHook(() => useAgentChat('session-1', false));
    act(() => result.current.sendMessage({ prompt: '搞个东西' }));

    await waitFor(() => expect(result.current.hitl?.kind).toBe('choice'));
    await act(async () => {
      await useHitlStore.getState().resolve({ approved: true, answerId: 'o1' });
    });

    expect(resumeBodies[0]).toMatchObject({ approved: true, answerId: 'o1' });
    await waitFor(() => expect(result.current.hitl).toBeNull());
  });

  it('reject：approved=false + feedback 透传', async () => {
    completionsEvents = [
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'tool_confirm',
        session_id: 'session-1',
        tool_calls: [{ id: 'c1', name: 'code_executor', args: {} }],
      },
      { type: 'RUN_PAUSED' },
    ];
    resumeEvents = [{ type: 'RUN_FINISHED' }];

    const { result } = renderHook(() => useAgentChat('session-1', false));
    act(() => result.current.sendMessage({ prompt: '执行' }));

    await waitFor(() => expect(result.current.hitl?.kind).toBe('tool_confirm'));
    await act(async () => {
      await useHitlStore.getState().resolve({ approved: false, feedback: '不要执行' });
    });

    expect(resumeBodies[0]).toMatchObject({
      approved: false,
      feedback: '不要执行',
    });
  });

  it('暂停守卫：paused 时 sendMessage 不发起新请求', async () => {
    completionsEvents = [
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'clarifying',
        session_id: 'session-1',
        question: 'q',
      },
      { type: 'RUN_PAUSED' },
    ];

    const fetchSpy = vi.mocked(globalThis.fetch);
    const { result } = renderHook(() => useAgentChat('session-1', false));
    act(() => result.current.sendMessage({ prompt: 'first' }));

    await waitFor(() => expect(result.current.hitl).not.toBeNull());

    act(() => result.current.sendMessage({ prompt: 'second' }));

    // 只有 completions 一次调用，resume 未被触发
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(resumeBodies).toHaveLength(0);
  });

  it('暂停态 abort：调用 /agent/abort 并出队', async () => {
    completionsEvents = [
      {
        type: 'USER_QUESTION_REQUEST',
        kind: 'tool_confirm',
        session_id: 'session-1',
        tool_calls: [{ id: 'c1', name: 'code_executor', args: {} }],
      },
      { type: 'RUN_PAUSED' },
    ];

    const { result } = renderHook(() => useAgentChat('session-1', false));
    act(() => result.current.sendMessage({ prompt: '执行' }));

    await waitFor(() => expect(result.current.hitl).not.toBeNull());

    act(() => result.current.abort());

    await waitFor(() => expect(clientMocks.post).toHaveBeenCalled());
    expect(clientMocks.post).toHaveBeenCalledWith(
      '/agent/abort',
      expect.objectContaining({ sessionId: 'session-1', reason: 'user_cancel' }),
    );
  });
});
