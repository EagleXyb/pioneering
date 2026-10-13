/**
 * useAgentChat 单元测试
 * 验证 AG-UI SSE 事件解析为 messages 与 stateMap
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock getAuthHeader — 避免访问真实 localStorage
vi.mock('../../../api/client', () => ({
  getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
}));

import { useAgentChat } from './useAgentChat';

/**
 * 构造模拟的 SSE Response
 * 将事件对象数组编码为 `data: {...}\n` 格式的 ReadableStream
 */
function createSSEResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('useAgentChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('解析 TEXT_MESSAGE_CONTENT 事件并累积到 assistant 消息', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { type: 'TEXT_MESSAGE_CONTENT', delta: '你好' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '世界' },
        { type: 'RUN_FINISHED' },
      ]),
    );

    const { result } = renderHook(() => useAgentChat('session-1', false));

    act(() => {
      result.current.sendMessage({ prompt: '测试' });
    });

    // 等待流处理完成
    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });

    // 验证消息
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[1].role).toBe('assistant');
    const assistantContent = result.current.messages[1].content!;
    expect(assistantContent[0].type).toBe('markdown');
    expect(assistantContent[0].data).toBe('你好世界');
  });

  it('解析 THINKING 事件并构建 stateMap 推理步骤', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { type: 'THINKING_START', title: '深度思考' },
        { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '分析中...' },
        { type: 'THINKING_END' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '回答' },
        { type: 'RUN_FINISHED' },
      ]),
    );

    const { result } = renderHook(() => useAgentChat('session-2', false));

    act(() => {
      result.current.sendMessage({ prompt: '分析' });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });

    // 刷新 React 批量更新，确保 stateMap 中的状态变更已应用
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // stateMap 应包含一个 thinking 步骤
    const steps = Object.values(result.current.stateMap);
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('thinking');
    expect(steps[0].label).toBe('深度思考');
    expect(steps[0].status).toBe('done');
    expect(steps[0].content).toBe('分析中...');
  });

  it('解析 TOOL_CALL 事件并构建工具调用步骤', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { type: 'TOOL_CALL_START', toolCallName: 'search' },
        { type: 'TOOL_CALL_ARGS', delta: '{"query":"test"}' },
        { type: 'TOOL_CALL_RESULT', toolCallName: 'search', content: '搜索结果' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '基于搜索结果回答' },
        { type: 'RUN_FINISHED' },
      ]),
    );

    const { result } = renderHook(() => useAgentChat('session-3', false));

    act(() => {
      result.current.sendMessage({ prompt: '搜索测试' });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });

    // 刷新 React 批量更新，确保 stateMap 中的状态变更已应用
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // stateMap 应包含 tool_call + tool_result 两个步骤
    const steps = Object.values(result.current.stateMap);
    expect(steps).toHaveLength(2);
    expect(steps[0].type).toBe('tool_call');
    expect(steps[0].label).toBe('调用工具 search');
    expect(steps[0].status).toBe('done');
    expect(steps[1].type).toBe('tool_result');
    expect(steps[1].label).toBe('工具结果: search');
    expect(steps[1].content).toBe('搜索结果');
  });

  it('RUN_ERROR 事件设置 error 状态并清理 running 步骤', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { type: 'THINKING_START', title: '推理' },
        { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '...' },
        { type: 'RUN_ERROR', message: '模型超时' },
      ]),
    );

    const { result } = renderHook(() => useAgentChat('session-4', false));

    act(() => {
      result.current.sendMessage({ prompt: '出错测试' });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    // 刷新 React 批量更新
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // running 状态的步骤应被标记为 done
    const steps = Object.values(result.current.stateMap);
    expect(steps.every((s) => s.status === 'done')).toBe(true);

    // assistant 消息：已产生的思考段保留，错误信息作为追加正文块落在序列尾部
    const blocks = result.current.messages[1]!.content!;
    expect(blocks[0]!.type).toBe('reasoning');
    const last = blocks[blocks.length - 1]!;
    expect(last.type).toBe('markdown');
    expect(String(last.data)).toContain('模型超时');
    expect(result.current.messages[1]!.status).toBe('error');
  });

  it('TAO 块序列：思考段与工具动作行按事件顺序交错写入消息 content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { type: 'THINKING_START', title: '深度思考', round: 1 },
        { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '先加载技能。' },
        { type: 'THINKING_END' },
        { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'library' },
        { type: 'TOOL_CALL_ARGS', delta: '{"skill":"library"}' },
        { type: 'TOOL_CALL_RESULT', toolCallId: 't1', toolCallName: 'library', content: '已加载' },
        { type: 'THINKING_START', title: '深度思考', round: 2 },
        { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '再核对节点。' },
        { type: 'THINKING_END' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '最终回答' },
        { type: 'RUN_FINISHED' },
      ]),
    );

    const { result } = renderHook(() => useAgentChat('session-tao', false));

    act(() => {
      result.current.sendMessage({ prompt: '分析' });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 块序列严格按到达顺序交错：思考 → 行动 → 思考 → 正文
    const blocks = result.current.messages[1]!.content!;
    expect(blocks.map((b) => b.type)).toEqual([
      'reasoning',
      'toolcall',
      'reasoning',
      'markdown',
    ]);

    // 动作行携带参数与观测结果（展开区数据源），并已收尾
    const tool = blocks[1] as { status?: string; data?: Record<string, unknown> };
    expect(tool.data?.toolCallName).toBe('library');
    expect(tool.data?.args).toBe('{"skill":"library"}');
    expect(tool.data?.result).toBe('已加载');
    expect(tool.status).toBe('complete');

    // 两个思考段互不粘连（各自独立成块）
    const first = blocks[0] as { data?: Array<{ data?: string }> };
    const second = blocks[2] as { data?: Array<{ data?: string }> };
    expect(first.data?.[0]?.data).toBe('先加载技能。');
    expect(second.data?.[0]?.data).toBe('再核对节点。');
  });

  it('运行启动先渲染「准备中」占位；THINKING_START 后就地提升为思考段', async () => {
    // 手动推送事件的流：能观察运行中的中间态（准备中 → 开始思考）
    let push: (evt: object) => void = () => {};
    let closeStream: () => void = () => {};
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        push = (evt) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n`));
        closeStream = () => controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const { result } = renderHook(() => useAgentChat('session-prep', false));
    act(() => {
      result.current.sendMessage({ prompt: '分析' });
    });

    // ① 发送后立即出现占位：Agent 已启动、思考尚未开始
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
    const placeholder = result.current.messages[1]!.content![0] as {
      type?: string;
      ext?: { phase?: string };
      data?: Array<{ data?: string }>;
    };
    expect(placeholder.type).toBe('reasoning');
    expect(placeholder.ext?.phase).toBe('preparing');
    expect(placeholder.data?.[0]?.data).toBe('');

    // ② THINKING_START + 增量：同一块就地提升（数量与位置不变，标题切“开始思考”）
    act(() => {
      push({ type: 'THINKING_START', title: '深度思考' });
      push({ type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '推理中…' });
    });
    await waitFor(() => {
      const block = result.current.messages[1]!.content![0] as {
        ext?: { phase?: string };
        data?: Array<{ data?: string }>;
      };
      expect(block.ext?.phase).toBe('thinking');
      expect(block.data?.[0]?.data).toBe('推理中…');
    });
    expect(result.current.messages[1]!.content).toHaveLength(1);

    // ③ 收尾：思考段 complete（标题回到“深度思考”，组件默认收起）
    act(() => {
      push({ type: 'RUN_FINISHED' });
      closeStream();
    });
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.messages[1]!.content![0]!.status).toBe('complete');
  });

  it('无 activeId 时不发送消息', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useAgentChat(null, false));

    act(() => {
      result.current.sendMessage({ prompt: '不应该发送' });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('请求体显式携带 agentMode=react_agent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'ok' },
        { type: 'RUN_FINISHED' },
      ]),
    );

    const { result } = renderHook(() => useAgentChat('session-pro', false));
    act(() => {
      result.current.sendMessage({ prompt: '分析需求' });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('/api/agent/completions');
    const body = JSON.parse(String((init as RequestInit).body ?? '{}'));
    expect(body).toMatchObject({
      sessionId: 'session-pro',
      message: '分析需求',
      stream: true,
      agentMode: 'react_agent',
    });
  });
});
