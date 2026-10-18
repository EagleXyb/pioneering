/**
 * 回归：chat 流式超时语义（P0 建立，P1 适配网关）
 *
 * 改造后链路为：core/llm.ts → llm-gateway → openai-compatible adapter → fetch。
 * 语义不变：
 *   - 外部 signal 中止（用户点停止）→ 不写 RUN_ERROR
 *   - 空闲超时 → RUN_ERROR / STREAM_TIMEOUT
 *   - 其他异常 → RUN_ERROR / STREAM_ERROR
 *
 * 这里通过构造会直接 error 的 ReadableStream 命中同一分支，不依赖真实计时器。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamAgui } from '../src/core/llm.ts';

const messages = [{ role: 'user', content: 'hi' }];

function stubFetchWithFailingStream(error: unknown) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
  const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function collect(gen: AsyncGenerator<string, void, unknown>): Promise<string> {
  let out = '';
  for await (const chunk of gen) out += chunk;
  return out;
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamAgui — 超时与中止（网关链路）', () => {
  it('空闲超时（无外部中止）→ RUN_ERROR / STREAM_TIMEOUT', async () => {
    stubFetchWithFailingStream(abortError());
    const out = await collect(streamAgui(messages, 'msg-timeout'));
    expect(out).toContain('RUN_ERROR');
    expect(out).toContain('STREAM_TIMEOUT');
  });

  it('外部中止（用户停止生成）→ 不写 RUN_ERROR', async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetchWithFailingStream(abortError());
    const out = await collect(
      streamAgui(messages, 'msg-abort', undefined, undefined, undefined, controller.signal),
    );
    expect(out).not.toContain('RUN_ERROR');
  });

  it('其他异常 → RUN_ERROR / STREAM_ERROR', async () => {
    stubFetchWithFailingStream(new Error('socket hang up'));
    const out = await collect(streamAgui(messages, 'msg-error'));
    expect(out).toContain('RUN_ERROR');
    expect(out).toContain('STREAM_ERROR');
  });

  it('LLM_GATEWAY_ENABLED=0 时回落到旧实现（不重试）', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream down', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.LLM_GATEWAY_ENABLED = '0';
    try {
      const out = await collect(streamAgui(messages, 'msg-legacy'));
      expect(out).toContain('RUN_ERROR');
      // 旧实现不重试；网关路径会重试 1 次
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.LLM_GATEWAY_ENABLED;
    }
  });
});
