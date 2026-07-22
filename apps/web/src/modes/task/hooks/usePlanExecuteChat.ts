import { useState, useRef, useCallback } from 'react';
import type { ChatMessagesData, ChatStatus } from '../../../types/tdesign';
import { getAuthHeader } from '../../../api/client';
import { usePlanExecuteStore } from '../../../store/planExecuteStore';

/**
 * 任务模式 Plan-and-Execute 对话 Hook
 *
 * 设计参考：apps/web/src/modes/pro/hooks/useAgentChat.ts 的 SSE 解析逻辑，
 * 关键差异：
 *   1. 多轮累积（pro 模式每次发送重置 messages，任务模式保留历史）
 *   2. 请求体新增 agentMode: 'plan_execute' 启用后端 Plan-Execute 图
 *   3. 新增 STATE_DELTA 事件处理 → planExecuteStore.applyPlanDelta
 *   4. 暴露 reset() 供会话切换时清空消息与 plan 状态
 *
 * SSE 事件协议（与后端 agui-adapter.ts 输出一致）：
 *   - STATE_DELTA: Plan-Execute 核心事件，携带 { phase, plan?, step_update? }
 *   - TEXT_MESSAGE_CONTENT: assistant 文本流式增量
 *   - TEXT_MESSAGE_END: assistant 文本结束
 *   - RUN_FINISHED: 整体运行结束
 *   - RUN_ERROR: 运行错误
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

      try {
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

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

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
            } catch {
              continue;
            }

            const eventType = data.type ?? '';

            switch (eventType) {
              case 'STATE_DELTA': {
                // Plan-Execute 核心事件：plan 阶段全量替换，execute 阶段增量更新
                applyPlanDelta({
                  phase: data.phase ?? '',
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
                setStatus('complete');
                setPhase('done');
                break;
              }
              case 'RUN_ERROR': {
                const errMsg = data.message ?? '执行失败';
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
            setPhase('done');
          }
        }
      } catch (e: any) {
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
    [activeId, status, applyPlanDelta, setPhase],
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

  return { messages, status, sendMessage, abort, reset };
}
