/**
 * P0 回归测试（2026-10-14）：流正常结束 ≠ 任务完成。
 *
 * 缺陷复刻（截图会话）：planner 产出 7 步计划 → 后端只发了 1 条 running 的
 * step_update 便静默终止 → RUN_FINISHED。旧实现无条件 setPhase('done')，
 * 面板出现"已完成"徽章 + "已完成 0/7 步"的自相矛盾展示。
 *
 * 修复：onRunFinished / closed 兜底按 planExecuteStore 中步骤实际状态判定——
 * 全部收敛（done/failed/skipped）才置 done，仍有 pending/running 置 incomplete。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../api/client', () => ({
  getAuthHeader: () => ({}),
  get: vi.fn(async () => null),
  post: vi.fn(async () => undefined),
}));

// loadHistory 不在本测试路径，仅保证模块可解析
vi.mock('../../../api/message', () => ({
  getMessages: vi.fn(async () => ({ messages: [] })),
}));
vi.mock('../../../api/plan', () => ({
  getMessagePlan: vi.fn(async () => ({ steps: [] })),
  patchCollapsedSteps: vi.fn(async () => undefined),
}));

import { usePlanExecuteChat } from './usePlanExecuteChat';
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

/** 复刻截图计划：7 步，star + chain 依赖，全 pending */
function screenshotPlan(): object[] {
  return [
    { step_id: 'step_1', title: '梳理知识框架与输出大纲', description: '', status: 'pending' },
    { step_id: 'step_2', title: '撰写基础提示技术章节', description: '', status: 'pending' },
    { step_id: 'step_3', title: '撰写上下文窗口管理四策略章节', description: '', status: 'pending' },
    { step_id: 'step_4', title: '撰写提示词版本管理章节', description: '', status: 'pending' },
    { step_id: 'step_5', title: '撰写跨模型Prompt适配章节', description: '', status: 'pending' },
    { step_id: 'step_6', title: '整合内容并生成Markdown文档', description: '', status: 'pending' },
    { step_id: 'step_7', title: '校验文档完整性与结构', description: '', status: 'pending' },
  ];
}

describe('usePlanExecuteChat — 流结束终态判定（P0）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePlanExecuteStore.getState().reset();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/completions') return sseResponse(completionsEvents);
      throw new Error(`unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    usePlanExecuteStore.getState().reset();
  });

  it('截图场景：7 步计划仅 1 条 running 后 RUN_FINISHED → incomplete（不得显示已完成）', async () => {
    completionsEvents = [
      { type: 'RUN_STARTED' },
      { type: 'STATE_DELTA', phase: 'plan', plan: screenshotPlan() },
      { type: 'STATE_DELTA', phase: 'execute', step_update: { id: 'step_1', status: 'running' } },
      { type: 'TEXT_MESSAGE_CONTENT', delta: '...' },
      { type: 'RUN_FINISHED' },
    ];

    const { result } = renderHook(() => usePlanExecuteChat('session-1'));
    await act(async () => {
      await result.current.sendMessage({ prompt: '测试任务' });
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    const state = usePlanExecuteStore.getState();
    expect(state.rootIds).toHaveLength(7);
    // step_1 仍 running、step_2..7 pending → 不得置 done
    expect(state.phase).toBe('incomplete');
  });

  it('全部步骤完成 → RUN_FINISHED 后 phase=done（不回归）', async () => {
    completionsEvents = [
      {
        type: 'STATE_DELTA',
        phase: 'plan',
        plan: [
          { step_id: 'step_1', title: 'A', description: '', status: 'pending' },
          { step_id: 'step_2', title: 'B', description: '', status: 'pending' },
        ],
      },
      { type: 'STATE_DELTA', phase: 'execute', step_update: { id: 'step_1', status: 'running' } },
      { type: 'STATE_DELTA', phase: 'execute', step_update: { id: 'step_1', status: 'done', result: 'ok' } },
      { type: 'STATE_DELTA', phase: 'execute', step_update: { id: 'step_2', status: 'running' } },
      { type: 'STATE_DELTA', phase: 'execute', step_update: { id: 'step_2', status: 'done', result: 'ok' } },
      { type: 'RUN_FINISHED' },
    ];

    const { result } = renderHook(() => usePlanExecuteChat('session-1'));
    await act(async () => {
      await result.current.sendMessage({ prompt: '测试任务' });
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(usePlanExecuteStore.getState().phase).toBe('done');
  });

  it('存在 skipped/failed 步骤但无未完成步骤 → 仍置 done（终态收敛语义）', async () => {
    completionsEvents = [
      {
        type: 'STATE_DELTA',
        phase: 'plan',
        plan: [
          { step_id: 'step_1', title: 'A', description: '', status: 'pending' },
          { step_id: 'step_2', title: 'B', description: '', status: 'pending' },
        ],
      },
      { type: 'STATE_DELTA', phase: 'execute', step_update: { id: 'step_1', status: 'done', result: 'ok' } },
      { type: 'STATE_DELTA', phase: 'execute', step_update: { id: 'step_2', status: 'failed', error: 'x' } },
      { type: 'RUN_FINISHED' },
    ];

    const { result } = renderHook(() => usePlanExecuteChat('session-1'));
    await act(async () => {
      await result.current.sendMessage({ prompt: '测试任务' });
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(usePlanExecuteStore.getState().phase).toBe('done');
  });

  it('无计划（规划失败降级直答）→ RUN_FINISHED 后 phase=done（不回归）', async () => {
    completionsEvents = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: '直接回答' },
      { type: 'RUN_FINISHED' },
    ];

    const { result } = renderHook(() => usePlanExecuteChat('session-1'));
    await act(async () => {
      await result.current.sendMessage({ prompt: '寒暄' });
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(usePlanExecuteStore.getState().phase).toBe('done');
  });
});
