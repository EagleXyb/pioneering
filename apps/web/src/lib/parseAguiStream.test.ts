/**
 * parseAguiStream 单元测试（阶段 4.2）
 * 重点：跨 chunk 粘包/拆包、脏行过滤、RUN_FINISHED/RUN_ERROR/中止 等边界
 */
import { describe, it, expect, vi } from 'vitest';
import { parseAguiStream, type AguiStreamHandlers } from './parseAguiStream';

function createResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const enc = new TextEncoder();
const sse = (obj: object) => enc.encode(`data: ${JSON.stringify(obj)}\n`);

/** 收集全部回调的简易 spy 容器 */
function spyHandlers() {
  const calls: Array<{ name: string; payload?: unknown }> = [];
  const handlers: AguiStreamHandlers = {
    onEvent: (e) => calls.push({ name: 'event', payload: e }),
    onRunStarted: () => calls.push({ name: 'started' }),
    onRunFinished: () => calls.push({ name: 'finished' }),
    onRunError: (e) => calls.push({ name: 'error', payload: e }),
    onTextStart: () => calls.push({ name: 'textStart' }),
    onTextDelta: (d) => calls.push({ name: 'textDelta', payload: d }),
    onTextEnd: () => calls.push({ name: 'textEnd' }),
    onThinkingStart: (e) => calls.push({ name: 'thinkingStart', payload: e }),
    onThinkingDelta: (d) =>
      calls.push({ name: 'thinkingDelta', payload: d }),
    onThinkingEnd: () => calls.push({ name: 'thinkingEnd' }),
    onToolCallStart: (e) =>
      calls.push({ name: 'toolStart', payload: e }),
    onToolCallArgs: (d) => calls.push({ name: 'toolArgs', payload: d }),
    onToolCallResult: (e) =>
      calls.push({ name: 'toolResult', payload: e }),
    onStateDelta: (e) => calls.push({ name: 'state', payload: e }),
    onHumanInputRequest: (e) =>
      calls.push({ name: 'humanInput', payload: e }),
    onRunPaused: (e) => calls.push({ name: 'paused', payload: e }),
    onHitlAborted: (e) =>
      calls.push({ name: 'hitlAborted', payload: e }),
    onArtifactCreated: (e) =>
      calls.push({ name: 'artifactCreated', payload: e }),
    onStateSnapshot: (e) =>
      calls.push({ name: 'stateSnapshot', payload: e }),
    onMessagesSnapshot: (e) =>
      calls.push({ name: 'messagesSnapshot', payload: e }),
  };
  return { calls, handlers };
}

describe('parseAguiStream', () => {
  it('正常流：分派文本/思考/工具事件并以 finished 结束', async () => {
    const res = createResponse([
      sse({ type: 'RUN_STARTED' }),
      sse({ type: 'THINKING_START', title: '深度思考' }),
      sse({ type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '嗯…' }),
      sse({ type: 'THINKING_END' }),
      sse({ type: 'TEXT_MESSAGE_START' }),
      sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '你好' }),
      sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '世界' }),
      sse({ type: 'TEXT_MESSAGE_END' }),
      sse({ type: 'TOOL_CALL_START', toolCallName: 'search' }),
      sse({ type: 'TOOL_CALL_ARGS', delta: '{"q":1}' }),
      sse({ type: 'TOOL_CALL_RESULT', content: 'r' }),
      sse({ type: 'RUN_FINISHED' }),
    ]);
    const { calls, handlers } = spyHandlers();

    const result = await parseAguiStream(res, handlers);

    expect(result.reason).toBe('finished');
    expect(result.eventCount).toBe(12);
    expect(result.eventTypes).toContain('TEXT_MESSAGE_CONTENT');
    expect(calls.filter((c) => c.name === 'textDelta').map((c) => c.payload)).toEqual([
      '你好',
      '世界',
    ]);
    expect(calls.filter((c) => c.name === 'thinkingDelta').map((c) => c.payload)).toEqual(['嗯…']);
    expect(calls.some((c) => c.name === 'toolStart')).toBe(true);
    expect(calls.find((c) => c.name === 'toolResult')).toMatchObject({
      name: 'toolResult',
    });
  });

  it('跨 chunk 拆包：一个事件被切成多段仍能完整解析', async () => {
    const eventLine = `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', delta: '拼包测试' })}\n`;
    const bytes = enc.encode(eventLine);
    // 从任意位置切成三段
    const cut1 = 13;
    const cut2 = 30;
    const res = createResponse([
      bytes.slice(0, cut1),
      bytes.slice(cut1, cut2),
      bytes.slice(cut2),
      enc.encode('data: {"type":"RUN_FINISHED"}\n'),
    ]);
    const { calls, handlers } = spyHandlers();

    const result = await parseAguiStream(res, handlers);

    expect(result.reason).toBe('finished');
    expect(calls.filter((c) => c.name === 'textDelta').map((c) => c.payload)).toEqual([
      '拼包测试',
    ]);
  });

  it('多个事件挤在同一 chunk（粘包）全部解析', async () => {
    const res = createResponse([
      enc.encode(
        `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', delta: 'a' })}\n` +
          `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', delta: 'b' })}\n`,
      ),
    ]);
    const { calls, handlers } = spyHandlers();
    const result = await parseAguiStream(res, handlers);
    expect(result.reason).toBe('closed'); // 无 RUN_FINISHED
    expect(calls.filter((c) => c.name === 'textDelta')).toHaveLength(2);
  });

  it('忽略空行/注释/非法 JSON/非 data 前缀与 [DONE] 标记', async () => {
    const res = createResponse([
      enc.encode(': heartbeat\n\n  \n'),
      enc.encode('event: message\ndata: not-a-json\n'),
      enc.encode('some random log line\n'),
      enc.encode('data: [DONE]\n'),
      sse({ type: 'RUN_FINISHED' }),
    ]);
    const { calls, handlers } = spyHandlers();
    const result = await parseAguiStream(res, handlers);
    expect(result.eventCount).toBe(1);
    expect(calls.filter((c) => c.name === 'event')).toHaveLength(1);
  });

  it('无末尾换行的最后一个事件仍被 flush', async () => {
    const last = `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', delta: '尾巴' })}`;
    const res = createResponse([enc.encode(last)]);
    const { calls, handlers } = spyHandlers();
    const result = await parseAguiStream(res, handlers);
    expect(result.eventCount).toBe(1);
    expect(calls.find((c) => c.name === 'textDelta')?.payload).toBe('尾巴');
    expect(result.reason).toBe('closed');
  });

  it('STATE_DELTA 原样透传负载（plan/execute）', async () => {
    const payload = {
      type: 'STATE_DELTA',
      phase: 'execute',
      step_update: { id: 's1', status: 'running' },
    };
    const res = createResponse([sse(payload), sse({ type: 'RUN_FINISHED' })]);
    const { calls, handlers } = spyHandlers();
    await parseAguiStream(res, handlers);
    expect(calls.find((c) => c.name === 'state')?.payload).toMatchObject({
      phase: 'execute',
      step_update: { id: 's1', status: 'running' },
    });
  });

  it('收到 RUN_ERROR 立即停止并返回错误信息', async () => {
    const res = createResponse([
      sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '已有文本' }),
      sse({ type: 'RUN_ERROR', message: '模型超时', code: 500 }),
      // 后续事件不应再被处理
      sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '不应出现' }),
    ]);
    const { calls, handlers } = spyHandlers();
    const result = await parseAguiStream(res, handlers);

    expect(result.reason).toBe('error-event');
    expect(result.error).toEqual({ message: '模型超时', code: 500 });
    expect(calls.filter((c) => c.name === 'textDelta')).toHaveLength(1);
    expect(calls.some((c) => c.name === 'error')).toBe(true);
  });

  it('RUN_ERROR 缺省 message 时回退为"执行失败"', async () => {
    const res = createResponse([sse({ type: 'RUN_ERROR' })]);
    const result = await parseAguiStream(res, spyHandlers().handlers);
    expect(result.error?.message).toBe('执行失败');
  });

  it('未知事件类型不报错（前向兼容）', async () => {
    const onEvent = vi.fn();
    const res = createResponse([
      sse({ type: 'FUTURE_EVENT_X', value: 1 }),
      sse({ type: 'RUN_FINISHED' }),
    ]);
    const result = await parseAguiStream(res, { onEvent });
    expect(result.reason).toBe('finished');
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FUTURE_EVENT_X' }),
    );
  });

  it('关联 signal 已中止时返回 aborted（流关闭路径）', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = createResponse([
      sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '半截' }),
    ]);
    const result = await parseAguiStream(res, {}, controller.signal);
    expect(result.reason).toBe('aborted');
  });

  it('response.body 为空时抛错', async () => {
    const res = new Response(null, { status: 200 });
    await expect(parseAguiStream(res, {})).rejects.toThrow(/无法读取/);
  });
});

describe('parseAguiStream —— HITL / Artifact 扩展事件', () => {
  it('USER_QUESTION_REQUEST 透传 tool_confirm snake_case 载荷', async () => {
    const payload = {
      type: 'USER_QUESTION_REQUEST',
      kind: 'tool_confirm',
      session_id: 's1',
      run_id: 'r1',
      tool_calls: [{ id: 'c1', name: 'code_executor', args: { cmd: 'ls' } }],
    };
    const res = createResponse([sse(payload)]);
    const { calls, handlers } = spyHandlers();

    const result = await parseAguiStream(res, handlers);

    expect(result.terminal).toBe(false); // 中断请求本身不是终态
    const call = calls.find((c) => c.name === 'humanInput')?.payload as Record<string, unknown>;
    expect(call).toMatchObject({
      kind: 'tool_confirm',
      session_id: 's1',
      run_id: 'r1',
      tool_calls: [{ id: 'c1', name: 'code_executor', args: { cmd: 'ls' } }],
    });
  });

  it('USER_QUESTION_REQUEST 透传 clarifying 载荷（含 question）', async () => {
    const res = createResponse([
      sse({
        type: 'USER_QUESTION_REQUEST',
        kind: 'clarifying',
        session_id: 's1',
        question: '你想做什么？',
      }),
    ]);
    const { calls, handlers } = spyHandlers();

    await parseAguiStream(res, handlers);

    const call = calls.find((c) => c.name === 'humanInput')?.payload as Record<string, unknown>;
    expect(call).toMatchObject({ kind: 'clarifying', question: '你想做什么？' });
  });

  it('RUN_PAUSED：返回 paused + terminal=true 并触发回调', async () => {
    const res = createResponse([
      sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '半截内容' }),
      sse({ type: 'RUN_PAUSED', threadId: 's1', runId: 'r1' }),
    ]);
    const { calls, handlers } = spyHandlers();

    const result = await parseAguiStream(res, handlers);

    expect(result.reason).toBe('paused');
    expect(result.terminal).toBe(true);
    expect(calls.some((c) => c.name === 'paused')).toBe(true);
  });

  it('RUN_PAUSED 后流未立即关闭：继续读取后续数据，结束仍为 paused', async () => {
    const res = createResponse([
      sse({ type: 'RUN_PAUSED', threadId: 's1', runId: 'r1' }),
      enc.encode(': keepalive\n'),
    ]);
    const result = await parseAguiStream(res, spyHandlers().handlers);
    expect(result.reason).toBe('paused');
    expect(result.terminal).toBe(true);
  });

  it('HITL_ABORTED：标记 terminal 并触发收尾回调', async () => {
    const res = createResponse([
      sse({ type: 'HITL_ABORTED', threadId: 's1', runId: 'r1', reason: 'timeout' }),
    ]);
    const { calls, handlers } = spyHandlers();

    const result = await parseAguiStream(res, handlers);

    expect(result.terminal).toBe(true);
    const call = calls.find((c) => c.name === 'hitlAborted')?.payload as Record<string, unknown>;
    expect(call).toMatchObject({ reason: 'timeout' });
  });

  it('HITL_ABORTED 后流关闭：reason 为 closed（中止语义由回调承载）', async () => {
    const res = createResponse([
      sse({ type: 'HITL_ABORTED', threadId: 's1', runId: 'r1' }),
    ]);
    const result = await parseAguiStream(res, {});
    expect(result.reason).toBe('closed');
    expect(result.terminal).toBe(true);
  });

  it('ARTIFACT_CREATED：透传产物全部字段', async () => {
    const payload = {
      type: 'ARTIFACT_CREATED',
      artifactId: 'a1',
      name: 'report.md',
      path: '/tmp/report.md',
      format: 'markdown',
      operation: 'create',
      summary: '报告摘要',
      title: '分析报告',
    };
    const res = createResponse([sse(payload)]);
    const { calls, handlers } = spyHandlers();

    await parseAguiStream(res, handlers);

    const call = calls.find((c) => c.name === 'artifactCreated')?.payload as Record<string, unknown>;
    expect(call).toMatchObject({
      artifactId: 'a1',
      name: 'report.md',
      format: 'markdown',
      title: '分析报告',
    });
  });

  it('ARTIFACT_CREATED 后接 RUN_FINISHED：两事件均不丢，reason=finished', async () => {
    const res = createResponse([
      sse({ type: 'ARTIFACT_CREATED', artifactId: 'a1' }),
      sse({ type: 'RUN_FINISHED' }),
    ]);
    const { calls, handlers } = spyHandlers();

    const result = await parseAguiStream(res, handlers);

    expect(result.reason).toBe('finished');
    expect(result.terminal).toBe(true);
    expect(calls.some((c) => c.name === 'artifactCreated')).toBe(true);
  });

  it('STATE_SNAPSHOT：回调收到快照负载', async () => {
    const res = createResponse([
      sse({ type: 'STATE_SNAPSHOT', values: { phase: 'planning' } }),
    ]);
    const { calls, handlers } = spyHandlers();

    await parseAguiStream(res, handlers);

    expect(
      (calls.find((c) => c.name === 'stateSnapshot')?.payload as Record<string, unknown>)?.values,
    ).toEqual({ phase: 'planning' });
  });

  it('MESSAGES_SNAPSHOT：回调收到快照负载', async () => {
    const res = createResponse([
      sse({ type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'm1' }] }),
    ]);
    const { calls, handlers } = spyHandlers();

    await parseAguiStream(res, handlers);

    expect(
      (calls.find((c) => c.name === 'messagesSnapshot')?.payload as Record<string, unknown>)
        ?.messages,
    ).toEqual([{ id: 'm1' }]);
  });

  it('STATE_SNAPSHOT 跨 chunk 拆包仍可完整解析', async () => {
    const line = `data: ${JSON.stringify({ type: 'STATE_SNAPSHOT', values: { count: 3 } })}\n`;
    const bytes = enc.encode(line);
    const res = createResponse([bytes.slice(0, 20), bytes.slice(20)]);
    const { calls, handlers } = spyHandlers();

    await parseAguiStream(res, handlers);

    expect(
      (calls.find((c) => c.name === 'stateSnapshot')?.payload as Record<string, unknown>)?.values,
    ).toEqual({ count: 3 });
  });

  it('MESSAGES_SNAPSHOT 空快照也触发回调', async () => {
    const res = createResponse([
      sse({ type: 'MESSAGES_SNAPSHOT', messages: [] }),
    ]);
    const { calls, handlers } = spyHandlers();

    await parseAguiStream(res, handlers);

    expect(calls.some((c) => c.name === 'messagesSnapshot')).toBe(true);
  });

  it('无任何终态事件流关闭：terminal=false，reason=closed', async () => {
    const res = createResponse([
      sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '普通文本' }),
    ]);
    const result = await parseAguiStream(res, {});
    expect(result.reason).toBe('closed');
    expect(result.terminal).toBe(false);
  });

  it('终态事件计数：RUN_FINISHED / RUN_ERROR 均标记 terminal', async () => {
    const finished = await parseAguiStream(
      createResponse([sse({ type: 'RUN_FINISHED' })]),
      {},
    );
    expect(finished.terminal).toBe(true);
    expect(finished.reason).toBe('finished');

    const errored = await parseAguiStream(
      createResponse([sse({ type: 'RUN_ERROR', message: 'boom' })]),
      {},
    );
    expect(errored.terminal).toBe(true);
    expect(errored.reason).toBe('error-event');
  });
});
