/**
 * P0 回归：Agent 通道模型透传
 *
 * 校验：
 *   - 显式传入 model 时写入请求体；
 *   - 未传时不写入该字段（由后端默认模型兜底，避免历史会话被旧模型名影响）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../api/client', () => ({
  getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
}));

import { useAgentChat } from './useAgentChat';

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
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function readBody(
  fetchSpy: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } },
  index = 0,
): Record<string, unknown> {
  const call = fetchSpy.mock.calls[index] ?? [];
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('useAgentChat — 模型透传（P0）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('传入 model 时写入请求体', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(createSSEResponse([{ type: 'RUN_FINISHED' }]));

    const { result } = renderHook(() => useAgentChat('session-model-1', false));
    act(() => {
      result.current.sendMessage({ prompt: '分析需求', model: 'reasoning' });
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(readBody(fetchSpy).model).toBe('reasoning');
  });

  it('未传 model 时请求体不含该字段', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(createSSEResponse([{ type: 'RUN_FINISHED' }]));

    const { result } = renderHook(() => useAgentChat('session-model-2', false));
    act(() => {
      result.current.sendMessage({ prompt: '分析需求' });
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect('model' in readBody(fetchSpy)).toBe(false);
  });
});
