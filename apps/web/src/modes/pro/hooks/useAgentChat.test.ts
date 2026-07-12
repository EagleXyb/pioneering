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

    // assistant 消息应包含错误信息
    const assistantMsg = result.current.messages[1];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content![0].data).toContain('模型超时');
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
});
