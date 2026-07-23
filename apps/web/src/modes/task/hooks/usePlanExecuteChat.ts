import { useState, useRef, useCallback } from 'react';
import type { ChatMessagesData, ChatStatus } from '../../../types/tdesign';
import { getAuthHeader } from '../../../api/client';
import { usePlanExecuteStore } from '../../../store/planExecuteStore';
import { getMessages } from '../../../api/message';
import { convertMessages } from '../../../api/converter';
import { getMessagePlan, patchCollapsedSteps } from '../../../api/plan';

/**
 * 任务模式 Plan-and-Execute 对话 Hook
 *
 * 设计参考：apps/web/src/modes/pro/hooks/useAgentChat.ts 的 SSE 解析逻辑，
 * 关键差异：
 *   1. 多轮累积（pro 模式每次发送重置 messages，任务模式保留历史）
 *   2. 请求体新增 agentMode: 'plan_execute' 启用后端 Plan-Execute 图
 *   3. 新增 STATE_DELTA 事件处理 → planExecuteStore.applyPlanDelta
 *   4. 暴露 reset() 供会话切换时清空消息与 plan 状态
 *   5. 暴露 loadHistory() 在会话切换时从后端恢复历史消息与 plan 时间轴快照
 *
 * SSE 事件协议（与后端 agui-adapter.ts 输出一致）：
 *   - STATE_DELTA: Plan-Execute 核心事件，携带 { phase, plan?, step_update? }
 *   - TEXT_MESSAGE_CONTENT: assistant 文本流式增量
 *   - TEXT_MESSAGE_END: assistant 文本结束
 *   - RUN_FINISHED: 整体运行结束（流结束后异步回传 collapsedSteps 至后端）
 *   - RUN_ERROR: 运行错误
 *
 * 持久化恢复链路：
 *   切换会话 → loadHistory(sessionId)
 *     ├─ getMessages 拉取历史消息 → convertMessages 转换
 *     └─ 若最后 assistant 消息 metadata.plan_phase 存在
 *         └─ getMessagePlan(msgId) → planExecuteStore.hydrateFromHistory
 */

interface SendMessageParams {
  prompt: string;
}

export function usePlanExecuteChat(activeId: string | null) {
  const [messages, setMessages] = useState<ChatMessagesData[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const applyPlanDelta = usePlanExecuteStore((s) => s.applyPlanDelta);
  const setPhase = usePlanExecuteStore((s) => s.setPhase);
  const resetPlan = usePlanExecuteStore((s) => s.reset);
  const hydrateFromHistory = usePlanExecuteStore((s) => s.hydrateFromHistory);

  /**
   * 流结束后异步回传用户折叠状态快照至后端，确保历史恢复时视觉细节一致。
   *
   * 触发条件：本次产生过 plan（planExecuteStore.rootIds 非空）。
   * 流程：
   *   1. 拉取最新 assistant 消息（后端持久化后才有真实 messageId）
   *   2. 若该消息已持久化 plan 数据（metadata.plan_phase 存在）
   *      则 PATCH collapsed_steps 到 chat_messages.metadata
   *   3. 失败静默降级，不影响已完成的消息渲染
   */
  const persistCollapsedSnapshot = useCallback(async (sessionId: string) => {
    const state = usePlanExecuteStore.getState();
    if (state.rootIds.length === 0) return;
    try {
      const resp = await getMessages(sessionId, undefined, 1, 'before');
      const lastAssistant = resp.messages.find((m) => m.role === 'assistant');
      if (!lastAssistant) return;
      const meta = lastAssistant.metadata as Record<string, any> | undefined;
      if (!meta?.plan_phase) return;
      await patchCollapsedSteps(lastAssistant.id, state.collapsedSteps);
    } catch (e) {
      console.warn('[task.plan_execute] persistCollapsedSnapshot.fail', e);
    }
  }, []);

  const sendMessage = useCallback(
    async (params: SendMessageParams) => {
      if (!activeId || status === 'streaming' || status === 'pending') return;

      // 中止可能存在的上一次请求
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // 构造用户消息与 assistant 占位消息（多轮累积，不重置）
      const ts = Date.now();
      const userMsg: ChatMessagesData = {
        id: `u_${ts}`,
        role: 'user',
        content: [{ type: 'text', data: params.prompt }],
      };
      const assistantMsg: ChatMessagesData = {
        id: `a_${ts}`,
        role: 'assistant',
        content: [{ type: 'text', data: '' }],
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStatus('streaming');
      setPhase('planning');

      // 累积文本用闭包变量，避免 React state 异步更新导致读取滞后
      let accumulatedText = '';

      const updateAssistantContent = (text: string) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: [{ type: 'text', data: text }] }
              : m,
          ),
        );
      };

      let eventCount = 0;
      const eventTypes = new Set<string>();

      try {
        console.info('[task.plan_execute] fetch.start session=%s prompt_len=%d', activeId, params.prompt.length);
        const response = await fetch('/api/agent/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({
            sessionId: activeId,
            message: params.prompt,
            stream: true,
            // 关键：启用后端 Plan-Execute 图
            agentMode: 'plan_execute',
          }),
          signal: controller.signal,
        });

        console.info(
          '[task.plan_execute] fetch.response status=%d ok=%s content_type=%s',
          response.status, response.ok, response.headers.get('content-type'),
        );

        if (!response.ok) {
          // 输出响应体便于排查 401/500 等错误
          const errText = await response.text().catch(() => '<read body failed>');
          console.error(
            '[task.plan_execute] fetch.not_ok status=%d body=%s',
            response.status, errText.slice(0, 500),
          );
          throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }

        if (!response.body) {
          throw new Error('response.body 为空（无 SSE 流）');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.info('[task.plan_execute] stream.done total_events=%d types=%j', eventCount, [...eventTypes]);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 保留最后未完成的行
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            let data: any;
            try {
              data = JSON.parse(dataStr);
            } catch (e) {
              console.warn('[task.plan_execute] parse.fail data=%s err=%s', dataStr.slice(0, 200), String(e));
              continue;
            }

            eventCount++;
            const eventType = data.type ?? '';
            eventTypes.add(eventType);

            // 调试日志：首次出现某事件类型时输出完整字段，便于排查字段不匹配
            if (!eventTypes.has(eventType + '_logged')) {
              console.info(
                '[task.plan_execute] event.first type=%s keys=%j sample=%s',
                eventType, Object.keys(data), JSON.stringify(data).slice(0, 300),
              );
              eventTypes.add(eventType + '_logged');
            }

            switch (eventType) {
              case 'STATE_DELTA': {
                // Plan-Execute 核心事件：plan 阶段全量替换，execute 阶段增量更新
                const phase = data.phase ?? '';
                if (phase === 'plan') {
                  console.info(
                    '[task.plan_execute] STATE_DELTA[plan] steps=%d',
                    Array.isArray(data.plan) ? data.plan.length : 0,
                  );
                } else if (phase === 'execute' && data.step_update) {
                  console.info(
                    '[task.plan_execute] STATE_DELTA[execute] %s → %s',
                    data.step_update.id, data.step_update.status,
                  );
                }
                applyPlanDelta({
                  phase,
                  plan: data.plan,
                  step_update: data.step_update,
                });
                break;
              }
              case 'TEXT_MESSAGE_CONTENT': {
                accumulatedText += data.delta ?? '';
                updateAssistantContent(accumulatedText);
                break;
              }
              case 'TEXT_MESSAGE_END': {
                // assistant 文本结束，保留内容不变
                break;
              }
              case 'RUN_FINISHED': {
                console.info('[task.plan_execute] RUN_FINISHED text_len=%d', accumulatedText.length);
                setStatus('complete');
                setPhase('done');
                // 流结束后异步回传用户折叠状态快照，确保历史恢复时视觉细节一致
                // 仅当本次产生过 plan（planExecuteStore 有 items）才回传，避免无谓请求
                void persistCollapsedSnapshot(activeId);
                break;
              }
              case 'RUN_ERROR': {
                const errMsg = data.message ?? '执行失败';
                console.error(
                  '[task.plan_execute] RUN_ERROR code=%s msg=%s',
                  data.code ?? '', errMsg,
                );
                setStatus('error');
                setPhase('error', errMsg);
                if (!accumulatedText) {
                  updateAssistantContent(`错误: ${errMsg}`);
                }
                break;
              }
            }
          }
        }

        // 流正常结束但未收到 RUN_FINISHED 事件时兜底
        // 使用 controller.signal.aborted 判断是否被中断，避免误判
        if (!controller.signal.aborted) {
          setStatus((prev) => (prev === 'streaming' ? 'complete' : prev));
          // setPhase 是 Zustand 直接 set 不支持函数式更新，需先读取当前状态
          const currentPhase = usePlanExecuteStore.getState().phase;
          if (currentPhase === 'planning' || currentPhase === 'executing') {
            console.info('[task.plan_execute] stream.end no RUN_FINISHED, fallback to done');
            setPhase('done');
          }
        }
      } catch (e: any) {
        console.error(
          '[task.plan_execute] catch.error name=%s msg=%s stack=%s events=%d types=%j',
          e?.name, String(e), e?.stack, eventCount, [...eventTypes],
        );
        if (e.name === 'AbortError') {
          // 用户主动中止，保留已累积的内容
          setStatus('complete');
          updateAssistantContent(accumulatedText);
        } else {
          setStatus('error');
          setPhase('error', String(e));
          if (!accumulatedText) {
            updateAssistantContent(`请求失败: ${String(e)}`);
          }
        }
      }
    },
    [activeId, status, applyPlanDelta, setPhase, persistCollapsedSnapshot],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setStatus('complete');
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStatus('idle');
    resetPlan();
  }, [resetPlan]);

  /**
   * 切换会话时从后端恢复历史消息与 plan 时间轴快照。
   *
   * 流程：
   *   1. 中止可能存在的流并清空内存状态
   *   2. getMessages 拉取历史消息 → convertMessages 转换为 ChatMessagesData
   *   3. 找最后一条 assistant 消息，若 metadata.plan_phase 存在
   *      则 getMessagePlan 拉取步骤快照 → hydrateFromHistory 装配时间轴
   *
   * 设计原则：
   *   - 历史恢复不重放 SSE，直接装配终态，避免 running 中间态闪烁
   *   - 失败时静默降级为空态，不影响消息渲染
   *   - 仅恢复最后一条 assistant 消息的 plan（任务模式每次发送对应一组 plan）
   */
  const loadHistory = useCallback(
    async (sessionId: string) => {
      // 1. 清空内存状态
      abortRef.current?.abort();
      setMessages([]);
      setStatus('idle');
      resetPlan();

      try {
        // 2. 拉取历史消息
        const resp = await getMessages(sessionId);
        const mapped = convertMessages(resp.messages);
        setMessages(mapped);

        // 3. 找最后一条 assistant 消息，装配 plan 时间轴
        const lastAssistant = [...mapped]
          .reverse()
          .find((m) => m.role === 'assistant');
        if (!lastAssistant) return;
        const meta = lastAssistant.metadata as Record<string, any> | undefined;
        if (!meta?.plan_phase) return;

        const snapshot = await getMessagePlan(lastAssistant.id);
        if (snapshot.steps.length > 0) {
          hydrateFromHistory(snapshot);
          console.info(
            '[task.plan_execute] loadHistory.restored session=%s msg=%s steps=%d phase=%s',
            sessionId, lastAssistant.id, snapshot.steps.length, snapshot.phase,
          );
        }
      } catch (e: any) {
        console.error('[task.plan_execute] loadHistory.error', e);
      }
    },
    [resetPlan, hydrateFromHistory],
  );

  return { messages, status, sendMessage, abort, reset, loadHistory };
}
