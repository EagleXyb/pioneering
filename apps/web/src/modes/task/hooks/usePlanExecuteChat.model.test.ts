/**
 * P0 回归：plan_execute 通道模型透传
 *
 * 与 pro 通道保持一致：显式传入才写入请求体，省略则由后端默认模型兜底。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../api/client', () => ({
  getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
}));

import { usePlanExecuteChat } from './usePlanExecuteChat';

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

describe('usePlanExecuteChat — 模型透传（P0）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('传入 model 时写入请求体', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(createSSEResponse([{ type: 'RUN_FINISHED' }]));

    const { result } = renderHook(() => usePlanExecuteChat('session-plan-1'));
    await act(async () => {
      await result.current.sendMessage({ prompt: '执行任务', model: 'reasoning' });
    });

    expect(readBody(fetchSpy).model).toBe('reasoning');
  });

  it('未传 model 时请求体不含该字段', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(createSSEResponse([{ type: 'RUN_FINISHED' }]));

    const { result } = renderHook(() => usePlanExecuteChat('session-plan-2'));
    await act(async () => {
      await result.current.sendMessage({ prompt: '执行任务' });
    });

    expect('model' in readBody(fetchSpy)).toBe(false);
  });
});
