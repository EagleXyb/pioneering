/**
 * P3 回归：统一 SSE 客户端
 *
 * 覆盖：运行时 API base、HTTP 错误分级、空闲超时看门狗、用户文案。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiUrl, setApiBaseUrl } from '../api/base-url';
import {
  requestAguiStream,
  streamErrorMessage,
  StreamRequestError,
} from './sseClient';

afterEach(() => {
  setApiBaseUrl(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiUrl —— 运行时 API base', () => {
  it('默认 /api，可被 setApiBaseUrl 覆盖并归一化尾部斜杠', () => {
    expect(apiUrl('/chat/completions')).toBe('/api/chat/completions');
    setApiBaseUrl('https://api.example.com/v1/');
    expect(apiUrl('/chat/completions')).toBe('https://api.example.com/v1/chat/completions');
    setApiBaseUrl(null);
    expect(apiUrl('/chat/completions')).toBe('/api/chat/completions');
  });
});

describe('requestAguiStream —— 错误分级', () => {
  it('429 → rate_limit，并透出服务端文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: '配额已用尽' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(requestAguiStream({ path: '/chat/completions', body: {} }, {})).rejects.toMatchObject({
      kind: 'rate_limit',
      status: 429,
      message: '配额已用尽',
      retryable: true,
    });
  });

  it('401 → auth，文案给出重新登录动作', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );

    try {
      await requestAguiStream({ path: '/chat/completions' }, {});
      throw new Error('应当抛错');
    } catch (e) {
      expect(StreamRequestError.is(e)).toBe(true);
      expect((e as StreamRequestError).kind).toBe('auth');
      expect(streamErrorMessage(e)).toContain('重新登录');
    }
  });
});

describe('requestAguiStream —— Last-Event-ID 续读', () => {
  it('RUN_STARTED 后断流：自动 GET 回放接口并带上 Last-Event-ID', async () => {
    const encoder = new TextEncoder();
    let call = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        call += 1;
        const url = String(input);
        if (call === 1) {
          // 首包：RUN_STARTED(id=1)，随后连接断开
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `id: 1\ndata: ${JSON.stringify({
                    type: 'RUN_STARTED',
                    threadId: 's1',
                    runId: 'run-1',
                  })}\n\n`,
                ),
              );
              // 先让首个 chunk 被读取，再模拟断流（同步 error 会丢弃已入队数据）
              setTimeout(() => controller.error(new Error('network down')), 0);
            },
          });
          return new Response(stream, { status: 200 });
        }

        // 回放：从 id=2 开始
        expect(url).toContain('/api/chat/runs/run-1/events');
        expect((init?.headers as Record<string, string>)['Last-Event-ID']).toBe('1');
        const replay = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `id: 2\ndata: ${JSON.stringify({ type: 'RUN_FINISHED' })}\n\n`,
              ),
            );
            controller.close();
          },
        });
        return new Response(replay, { status: 200 });
      }),
    );

    const seen: string[] = [];
    const result = await requestAguiStream(
      { path: '/chat/completions', body: { message: 'hi' } },
      { onEvent: (e) => seen.push(e.type) },
    );

    expect(call).toBe(2);
    expect(result.reason).toBe('finished');
    expect(result.lastEventId).toBe('2');
    expect(seen).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
  });
});

describe('requestAguiStream —— 空闲超时', () => {
  it('长时间无数据触发 timeout，而不是无限等待', async () => {
    // 永远不关闭、也不产出数据的流
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    await expect(
      requestAguiStream(
        { path: '/chat/completions', idleTimeoutMs: 20 },
        {},
      ),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
