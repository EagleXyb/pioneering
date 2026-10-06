/**
 * useAguiChat 单元测试（阶段 4.3，≥15 例）
 * 覆盖：流式累积、状态序列、思考块、错误事件、HTTP 错误、abort 停止、
 * 历史替换、防重入、deepThink/auth 透传、停止后可再发。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../api/client', () => ({
  getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
}));

import { useAguiChat } from './useAguiChat';
import type { ChatMessagesData } from '../../../types/chat';

const encoder = new TextEncoder();

function sseResponse(events: object[], chunkDelay = 0): Response {
  const chunks = events.map((e) =>
    encoder.encode(`data: ${JSON.stringify(e)}\n`),
  );
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (chunkDelay) await new Promise((r) => setTimeout(r, chunkDelay));
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** 可变 sessionId 容器，模拟 store.getState().activeId */
function sessionHolder(id: string | null) {
  const ref = { current: id };
  return [
    () => ref.current,
    (id: string | null) => {
      ref.current = id;
    },
  ] as const;
}

const last = (msgs: ChatMessagesData[]) => msgs[msgs.length - 1];

describe('useAguiChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. 无 sessionId 时不发请求', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const [getSession] = sessionHolder(null);
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() =>
      result.current.sendUserMessage({ prompt: 'hi' }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('2. 请求头带鉴权、请求体透传 sessionId/message/deepThink/netSearch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ type: 'RUN_FINISHED' }]));
    const [getSession] = sessionHolder('sess-1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() =>
      result.current.sendUserMessage({
        prompt: '你好',
        deepThink: true,
        netSearch: true,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('complete'));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/chat/completions');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse(init?.body as string)).toEqual({
      sessionId: 'sess-1',
      message: '你好',
      stream: true,
      deepThink: true,
      netSearch: true,
    });
  });

  it('3. 发送后追加 user + assistant 两条消息', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([{ type: 'RUN_FINISHED' }]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: '问' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
    });
  });

  it('4. 状态序列：pending → streaming → complete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(
        [
          { type: 'TEXT_MESSAGE_CONTENT', delta: 'a' },
          { type: 'RUN_FINISHED' },
        ],
        20,
      ),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    const seen: string[] = [];

    act(() => result.current.sendUserMessage({ prompt: 'x' }));
    seen.push(result.current.status); // pending
    await waitFor(() => expect(result.current.status).toBe('complete'));

    expect(seen[0]).toBe('pending');
    expect(seen).toContain('pending');
  });

  it('5. 文本增量按顺序累积到 markdown content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'TEXT_MESSAGE_START' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '你' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '好' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '世界' },
        { type: 'TEXT_MESSAGE_END' },
        { type: 'RUN_FINISHED' },
      ]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));

    const ai = last(result.current.messages);
    expect(ai.role).toBe('assistant');
    expect(ai.content?.[0]).toMatchObject({ type: 'markdown', data: '你好世界' });
    expect(ai.status).toBe('complete');
  });

  it('6. 思考增量写入 reasoning 块且在 markdown 之前', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'THINKING_START' },
        { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '先想想' },
        { type: 'THINKING_END' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '答案' },
        { type: 'RUN_FINISHED' },
      ]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));

    const content = last(result.current.messages).content!;
    expect(content[0].type).toBe('reasoning');
    expect((content[0] as { data: { data: string }[] }).data[0].data).toBe('先想想');
    expect(content[1]).toMatchObject({ type: 'markdown', data: '答案' });
  });

  it('7. RUN_FINISHED 后状态为 complete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'ok' },
        { type: 'RUN_FINISHED' },
      ]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(last(result.current.messages).status).toBe('complete');
  });

  it('8. 无 RUN_FINISHED 流正常关闭时兜底为 complete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'ok' }]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));
  });

  it('9. RUN_ERROR 无正文：status=error 且消息展示错误文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([{ type: 'RUN_ERROR', message: '模型超时' }]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    const ai = last(result.current.messages);
    expect(ai.status).toBe('error');
    expect(ai.content?.[0]).toMatchObject({
      type: 'text',
      data: '模型超时',
    });
  });

  it('10. RUN_ERROR 缺省 message 显示兜底文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([{ type: 'RUN_ERROR' }]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    const first = last(result.current.messages).content?.[0] as {
      data?: string;
    };
    expect(first.data).toContain('生成失败');
  });

  it('11. RUN_ERROR 有正文：保留已生成正文', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'TEXT_MESSAGE_CONTENT', delta: '已写出的正文' },
        { type: 'RUN_ERROR', message: '尾部失败' },
      ]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(last(result.current.messages).content?.[0]).toMatchObject({
      type: 'markdown',
      data: '已写出的正文',
    });
  });

  it('12. HTTP 4xx/5xx：status=error 且消息展示请求失败', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '鉴权失败' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(last(result.current.messages).content?.[0]).toMatchObject({
      type: 'text',
    });
  });

  it('13. abortChat() 中止流：status=complete、消息 status=stop、保留已生成内容', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(
        [
          { type: 'TEXT_MESSAGE_CONTENT', delta: '半截' },
          { type: 'TEXT_MESSAGE_CONTENT', delta: '内容' },
        ],
        50,
      ),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: 'q' }));
    // 等首个 chunk 落地后中止
    await act(async () => {
      await new Promise((r) => setTimeout(r, 70));
      result.current.abortChat();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(result.current.status).toBe('complete');
    expect(last(result.current.messages).status).toBe('stop');
  });

  it('14. setMessages(replace) 整包替换历史', () => {
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));
    const history: ChatMessagesData[] = [
      { id: 'h1', role: 'user', content: [{ type: 'text', data: '历史提问' }] },
      {
        id: 'h2',
        role: 'assistant',
        content: [{ type: 'markdown', data: '历史回答' }],
      },
    ];
    act(() => result.current.setMessages(history, 'replace'));
    expect(result.current.messages).toEqual(history);
  });

  it('15. 流式进行中重复调用 sendUserMessage 被忽略（不发第二个请求）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(
        [{ type: 'TEXT_MESSAGE_CONTENT', delta: 'a' }],
        60,
      ),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: 'first' }));
    act(() => result.current.sendUserMessage({ prompt: 'second' }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 90));
    });
  });

  it('16. 上一轮停止/完成后可以再次发送（多轮）', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        sseResponse([{ type: 'TEXT_MESSAGE_CONTENT', delta: '第一轮' }]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'TEXT_MESSAGE_CONTENT', delta: '第二轮' },
          { type: 'RUN_FINISHED' },
        ]),
      );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: 'q1' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));

    act(() => result.current.sendUserMessage({ prompt: 'q2' }));
    await waitFor(() => expect(result.current.status).toBe('complete'));

    expect(result.current.messages).toHaveLength(4);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('17. WEB_SEARCH_SOURCES 事件：assistant 消息包含 search 内容块', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        {
          type: 'WEB_SEARCH_SOURCES',
          sources: [
            { title: '来源A', url: 'https://a.com/x', content: '摘要A', site: 'a.com' },
            { title: '来源B', url: 'https://b.com/y', content: '摘要B', site: 'b.com' },
          ],
        },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '结论' },
        { type: 'RUN_FINISHED' },
      ]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: 'q', netSearch: true }));
    await waitFor(() => expect(result.current.status).toBe('complete'));

    const ai = last(result.current.messages);
    const searchBlock = ai.content?.find((c) => c.type === 'search');
    expect(searchBlock).toMatchObject({
      type: 'search',
      data: {
        references: [
          { title: '来源A', url: 'https://a.com/x', content: '摘要A', site: 'a.com' },
          { title: '来源B', url: 'https://b.com/y', content: '摘要B', site: 'b.com' },
        ],
      },
    });
    // 正文仍正常累积
    expect(ai.content?.[ai.content.length - 1]).toMatchObject({
      type: 'markdown',
      data: '结论',
    });
  });

  it('18. 非法 sources 负载不会产生 search 内容块', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { type: 'WEB_SEARCH_SOURCES', sources: 'not-an-array' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'ok' },
        { type: 'RUN_FINISHED' },
      ]),
    );
    const [getSession] = sessionHolder('s1');
    const { result } = renderHook(() => useAguiChat(getSession));

    act(() => result.current.sendUserMessage({ prompt: 'q', netSearch: true }));
    await waitFor(() => expect(result.current.status).toBe('complete'));

    const ai = last(result.current.messages);
    expect(ai.content?.some((c) => c.type === 'search')).toBe(false);
  });
});
