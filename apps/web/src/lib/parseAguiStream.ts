/**
 * AG-UI SSE 流解析器（阶段 4.2）
 *
 * 收敛 useAgentChat（pro）与 usePlanExecuteChat（task）两份重复的
 * "reader + TextDecoder + 行缓冲 + data: 前缀 + JSON.parse" 逻辑。
 *
 * 协议事件（与后端 agui-adapter 输出一致）：
 *   RUN_STARTED / RUN_FINISHED / RUN_ERROR
 *   TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END
 *   THINKING_START / THINKING_TEXT_MESSAGE_CONTENT / THINKING_END
 *   TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / TOOL_CALL_RESULT
 *   STATE_DELTA / WEB_SEARCH_SOURCES
 *   USER_QUESTION_REQUEST / RUN_PAUSED / HITL_ABORTED
 *   ARTIFACT_CREATED / STATE_SNAPSHOT / MESSAGES_SNAPSHOT
 *
 * 纯函数：不持有 React 状态，所有副作用通过 handlers 回调由调用方注入；
 * 不做 fetch（HTTP 状态码处理留在 hook 层），只负责把 Response.body 解析成事件。
 */

/** AG-UI 原始事件（字段随事件类型不同而不同） */
export interface AguiEvent {
  type: string;
  [key: string]: unknown;
}

/** 文本/思考增量的取值 */
const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface AguiStreamHandlers {
  /** 每个成功解析的事件都会先触发（调试/打点用） */
  onEvent?: (event: AguiEvent) => void;
  onRunStarted?: (event: AguiEvent) => void;
  onRunFinished?: (event: AguiEvent) => void;
  onRunError?: (event: AguiEvent) => void;
  onTextStart?: (event: AguiEvent) => void;
  /** 本次增量 + 当前累计文本由调用方自行维护，这里只回传单次 delta */
  onTextDelta?: (delta: string, event: AguiEvent) => void;
  onTextEnd?: (event: AguiEvent) => void;
  onThinkingStart?: (event: AguiEvent) => void;
  onThinkingDelta?: (delta: string, event: AguiEvent) => void;
  onThinkingEnd?: (event: AguiEvent) => void;
  onToolCallStart?: (event: AguiEvent) => void;
  onToolCallArgs?: (delta: string, event: AguiEvent) => void;
  onToolCallEnd?: (event: AguiEvent) => void;
  onToolCallResult?: (event: AguiEvent) => void;
  /** Plan-Execute 的 { phase, plan?, step_update? } 等自定义负载 */
  onStateDelta?: (event: AguiEvent) => void;
  /** 联网搜索结构化来源：{ sources: [{title,url,content,site}] } */
  onWebSearchSources?: (sources: unknown, event: AguiEvent) => void;
  /** HITL：USER_QUESTION_REQUEST 中断请求（载荷 snake_case，pro/task 消费） */
  onHumanInputRequest?: (event: AguiEvent) => void;
  /** HITL：run 已暂停（调用方不 finalize，保留 streamingMessageId 供续写） */
  onRunPaused?: (event: AguiEvent) => void;
  /** HITL：待确认操作被中止（拒绝/超时），调用方需收尾 */
  onHitlAborted?: (event: AguiEvent) => void;
  /** Artifact 创建事件（W4 消费） */
  onArtifactCreated?: (event: AguiEvent) => void;
  /** 全量状态快照（预留） */
  onStateSnapshot?: (event: AguiEvent) => void;
  /** 全量消息快照（预留） */
  onMessagesSnapshot?: (event: AguiEvent) => void;
}

export type AguiStreamEndReason =
  | 'finished' // 收到 RUN_FINISHED 且流正常关闭
  | 'closed' // 流正常关闭但未收到 RUN_FINISHED（后端协议兜底场景）
  | 'error-event' // 收到 RUN_ERROR
  | 'aborted' // 请求被 AbortController 中止
  | 'paused'; // 收到 RUN_PAUSED：HITL 中断待答复，调用方不 finalize

/** 终态事件集合：收到任一事件即标记 terminal=true */
export const TERMINAL_AGUI_EVENTS = [
  'RUN_FINISHED',
  'RUN_ERROR',
  'RUN_PAUSED',
  'HITL_ABORTED',
] as const;

export interface AguiStreamResult {
  reason: AguiStreamEndReason;
  error?: { message: string; code?: string | number };
  eventCount: number;
  /** 实际接收到的全部事件类型（去重，便于测试与排障） */
  eventTypes: string[];
  /** 是否收到终态事件（RUN_FINISHED / RUN_ERROR / RUN_PAUSED / HITL_ABORTED） */
  terminal: boolean;
}

/**
 * 逐行读取并解析 AG-UI SSE 流。
 *
 * @param response 已通过 ok 校验的 fetch Response
 * @param handlers 事件回调
 * @param signal   关联的 AbortController.signal，用于识别中止
 */
export async function parseAguiStream(
  response: Response,
  handlers: AguiStreamHandlers,
  signal?: AbortSignal,
): Promise<AguiStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流（response.body 为空）');

  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;
  const eventTypes = new Set<string>();
  let sawRunFinished = false;
  let sawRunPaused = false;
  let sawHitlAborted = false;
  let streamError: AguiStreamResult['error'];

  const dispatch = (event: AguiEvent) => {
    handlers.onEvent?.(event);
    switch (event.type) {
      case 'RUN_STARTED':
        handlers.onRunStarted?.(event);
        break;
      case 'RUN_FINISHED':
        sawRunFinished = true;
        handlers.onRunFinished?.(event);
        break;
      case 'RUN_ERROR':
        streamError = {
          message: typeof event.message === 'string' ? event.message : '执行失败',
          code: event.code as string | number | undefined,
        };
        handlers.onRunError?.(event);
        break;
      case 'TEXT_MESSAGE_START':
        handlers.onTextStart?.(event);
        break;
      case 'TEXT_MESSAGE_CONTENT':
        handlers.onTextDelta?.(asText(event.delta), event);
        break;
      case 'TEXT_MESSAGE_END':
        handlers.onTextEnd?.(event);
        break;
      case 'THINKING_START':
        handlers.onThinkingStart?.(event);
        break;
      case 'THINKING_TEXT_MESSAGE_CONTENT':
        handlers.onThinkingDelta?.(asText(event.delta), event);
        break;
      case 'THINKING_END':
        handlers.onThinkingEnd?.(event);
        break;
      case 'TOOL_CALL_START':
        handlers.onToolCallStart?.(event);
        break;
      case 'TOOL_CALL_ARGS':
        handlers.onToolCallArgs?.(asText(event.delta), event);
        break;
      case 'TOOL_CALL_END':
        handlers.onToolCallEnd?.(event);
        break;
      case 'TOOL_CALL_RESULT':
        handlers.onToolCallResult?.(event);
        break;
      case 'STATE_DELTA':
        handlers.onStateDelta?.(event);
        break;
      case 'WEB_SEARCH_SOURCES':
        handlers.onWebSearchSources?.(event.sources, event);
        break;
      case 'USER_QUESTION_REQUEST':
        handlers.onHumanInputRequest?.(event);
        break;
      case 'RUN_PAUSED':
        sawRunPaused = true;
        handlers.onRunPaused?.(event);
        break;
      case 'HITL_ABORTED':
        sawHitlAborted = true;
        handlers.onHitlAborted?.(event);
        break;
      case 'ARTIFACT_CREATED':
        handlers.onArtifactCreated?.(event);
        break;
      case 'STATE_SNAPSHOT':
        handlers.onStateSnapshot?.(event);
        break;
      case 'MESSAGES_SNAPSHOT':
        handlers.onMessagesSnapshot?.(event);
        break;
      default:
        // 前向兼容：后端新增事件类型时不报错
        break;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // 最后一段可能是未完成的行，留到下一次 chunk 拼接
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let event: AguiEvent;
      try {
        event = JSON.parse(payload) as AguiEvent;
      } catch {
        // 心跳/注释/脏数据直接忽略
        continue;
      }

      eventCount++;
      if (typeof event.type === 'string') eventTypes.add(event.type);
      dispatch(event);

      if (streamError) {
        return {
          reason: 'error-event',
          error: streamError,
          eventCount,
          eventTypes: [...eventTypes],
          terminal: true,
        };
      }
    }
  }

  // 收尾 flush：部分后端不保证末尾换行
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const payload = tail.slice(5).trim();
    if (payload && payload !== '[DONE]') {
      try {
        const event = JSON.parse(payload) as AguiEvent;
        eventCount++;
        if (typeof event.type === 'string') eventTypes.add(event.type);
        dispatch(event);
      } catch {
        // 忽略不完整尾部
      }
    }
  }

  if (streamError) {
    return {
      reason: 'error-event',
      error: streamError,
      eventCount,
      eventTypes: [...eventTypes],
      terminal: true,
    };
  }

  const terminal = sawRunFinished || sawRunPaused || sawHitlAborted;

  if (signal?.aborted) {
    return {
      reason: 'aborted',
      eventCount,
      eventTypes: [...eventTypes],
      terminal,
    };
  }

  return {
    reason: sawRunPaused ? 'paused' : sawRunFinished ? 'finished' : 'closed',
    eventCount,
    eventTypes: [...eventTypes],
    terminal,
  };
}
