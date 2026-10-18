/**
 * AG-UI SSE 统一客户端（P3）
 *
 * 承担三件事：
 *   1. 统一的 URL / 鉴权头 / 请求体构造（替代各 hook 里散落的 fetch）
 *   2. 空闲看门狗：超过阈值没有任何字节（含后端 `: ping` 心跳）即报超时
 *   3. 错误分级：HTTP 状态与网络异常收敛为有限 kind，供 UI 给出可操作文案
 *
 * 不做自动重连：当前后端未提供事件 id / Last-Event-ID 回放，对 POST 流做自动
 * 重连会导致重复消息。网络错误统一标记为 retryable，由 UI 的「重新生成」触发。
 */
import { getAuthHeader } from '../api/client';
import { apiUrl } from '../api/base-url';
import {
  parseAguiStream,
  type AguiStreamHandlers,
  type AguiStreamResult,
} from './parseAguiStream';

export type StreamErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'server'
  | 'bad_request'
  | 'network'
  | 'unknown';

export interface StreamErrorOptions {
  status?: number;
  retryable?: boolean;
  cause?: unknown;
}

export class StreamRequestError extends Error {
  readonly kind: StreamErrorKind;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(kind: StreamErrorKind, message: string, opts: StreamErrorOptions = {}) {
    super(message);
    this.name = 'StreamRequestError';
    this.kind = kind;
    this.status = opts.status;
    // Error.cause 在 ES2022 才进标准库；此处手动挂载，兼容当前 target
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
    this.retryable =
      opts.retryable ??
      (kind === 'rate_limit' ||
        kind === 'server' ||
        kind === 'timeout' ||
        kind === 'network');
  }

  static is(e: unknown): e is StreamRequestError {
    return e instanceof StreamRequestError;
  }
}

/** 默认空闲阈值：后端心跳 15s，留 4 倍余量。 */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

function timeoutError(cause?: unknown): StreamRequestError {
  return new StreamRequestError('timeout', '响应超时，请重试', {
    cause,
    retryable: true,
  });
}

async function toHttpError(response: Response): Promise<StreamRequestError> {
  let message = `请求失败（HTTP ${response.status}）`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body?.message === 'string' && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // 非 JSON 响应体：保留状态码文案
  }

  const status = response.status;
  const kind: StreamErrorKind =
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rate_limit'
        : status >= 500
          ? 'server'
          : 'bad_request';

  return new StreamRequestError(kind, message, {
    status,
    retryable: kind === 'rate_limit' || kind === 'server',
  });
}

/** 把任意异常归一化为可分类的流错误。 */
export function classifyStreamError(e: unknown): StreamRequestError {
  if (StreamRequestError.is(e)) return e;
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === 'AbortError') {
    return new StreamRequestError('network', '请求已中止', { retryable: false, cause: e });
  }
  return new StreamRequestError('network', '网络异常，请检查连接后重试', {
    cause: e,
    retryable: true,
  });
}

const ERROR_COPY: Record<StreamErrorKind, string> = {
  auth: '登录已过期，请重新登录',
  rate_limit: '请求过于频繁或配额不足，请稍后重试',
  timeout: '响应超时，请重试',
  server: '服务暂时不可用，请稍后重试',
  bad_request: '请求未被接受，请调整后重试',
  network: '网络异常，请检查连接后重试',
  unknown: '请求失败，请稍后重试',
};

/**
 * 面向用户的错误文案。
 *
 * @param e        捕获到的异常
 * @param fallback 非流错误时的兜底文案
 */
export function streamErrorMessage(e: unknown, fallback = '请求失败，请稍后重试'): string {
  if (!StreamRequestError.is(e)) {
    return (e as { message?: string })?.message || fallback;
  }
  // 服务端给了具体原因（如「配额已用尽」）时优先透出，再补动作提示
  const serverMessage = e.message && e.message !== '响应超时，请重试' ? e.message : '';
  if (e.kind === 'bad_request' || e.kind === 'server') {
    return serverMessage || ERROR_COPY[e.kind];
  }
  return ERROR_COPY[e.kind] || serverMessage || fallback;
}

/** 是否为超时类错误（供调用方区分用户主动中止）。 */
export function isTimeoutError(e: unknown): boolean {
  return StreamRequestError.is(e) && e.kind === 'timeout';
}

/**
 * 给已有 Response 挂上空闲看门狗（pro / task 走 api/agent 的 fetch 时使用）。
 *
 * 超时会以 `StreamRequestError('timeout')` 让响应体报错，
 * 调用方在 catch 中通过 `isTimeoutError` 识别。
 */
export function monitorAguiResponse(
  response: Response,
  opts: { idleTimeoutMs?: number } = {},
): { response: Response; timedOut: () => boolean; dispose: () => void } {
  const idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  if (!response.body || idleMs <= 0) {
    return { response, timedOut: () => false, dispose: () => undefined };
  }

  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    clear();
    timer = setTimeout(() => {
      timedOut = true;
      try {
        streamController?.error(timeoutError());
      } catch {
        // 流已关闭：忽略
      }
    }, idleMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  // 不使用 TransformStream：jsdom 测试环境不保证提供，改用 reader 手动转发。
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      schedule();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              clear();
              controller.close();
              return;
            }
            schedule();
            controller.enqueue(value);
          }
        } catch (e) {
          clear();
          controller.error(e);
        }
      })();
    },
    cancel() {
      clear();
      return reader.cancel();
    },
  });

  const monitored = new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  return {
    response: monitored,
    timedOut: () => timedOut,
    dispose: clear,
  };
}

export interface RequestAguiStreamOptions {
  /** 以 / 开头的 API 路径，如 '/chat/completions' */
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  /** 响应已通过 ok 校验、即将开始解析时回调（用于把状态从 pending 切到 streaming） */
  onOpen?: () => void;
}

/**
 * 发起一次 AG-UI 流式请求并解析到结束。
 *
 * P5：网络/服务端错误发生在 `RUN_STARTED` 之后时，自动用 `Last-Event-ID`
 * 从 `/chat/runs/:runId/events` 续读（最多 2 次），不重复请求模型。
 *
 * 抛出的错误统一为 `StreamRequestError`（超时 / 鉴权 / 限流 / 服务端 / 网络）。
 */
export async function requestAguiStream(
  opts: RequestAguiStreamOptions,
  handlers: AguiStreamHandlers,
): Promise<AguiStreamResult> {
  let runId: string | undefined;
  let lastEventId: string | undefined;

  const wrappedHandlers: AguiStreamHandlers = {
    ...handlers,
    onEvent: (event, meta) => {
      if (meta?.id) lastEventId = meta.id;
      if (
        !runId &&
        event.type === 'RUN_STARTED' &&
        typeof event.runId === 'string'
      ) {
        runId = event.runId;
      }
      handlers.onEvent?.(event, meta);
    },
  };

  const open = async (resume: boolean): Promise<Response> => {
    const url =
      resume && runId
        ? apiUrl(`/chat/runs/${encodeURIComponent(runId)}/events`)
        : apiUrl(opts.path);
    const headers: Record<string, string> = resume
      ? { Accept: 'text/event-stream', ...getAuthHeader() }
      : { 'Content-Type': 'application/json', ...getAuthHeader() };
    if (resume && lastEventId) headers['Last-Event-ID'] = lastEventId;

    const response = await fetch(url, {
      method: resume ? 'GET' : 'POST',
      headers: { ...headers, ...(opts.headers ?? {}) },
      body:
        resume || opts.body === undefined
          ? undefined
          : JSON.stringify(opts.body),
      signal: opts.signal,
    });
    if (!response.ok) {
      throw await toHttpError(response);
    }
    opts.onOpen?.();
    return response;
  };

  let resume = false;
  let attempt = 0;

  for (;;) {
    let monitor: ReturnType<typeof monitorAguiResponse> | null = null;
    try {
      const response = await open(resume);
      monitor = monitorAguiResponse(response, {
        idleTimeoutMs: opts.idleTimeoutMs,
      });

      const result = await parseAguiStream(
        monitor.response,
        wrappedHandlers,
        opts.signal,
      );
      lastEventId = result.lastEventId ?? lastEventId;
      if (monitor.timedOut() && !opts.signal?.aborted) {
        throw timeoutError();
      }
      return result;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (monitor?.timedOut()) throw timeoutError(e);

      const err = StreamRequestError.is(e) ? e : classifyStreamError(e);
      const canResume =
        Boolean(runId) &&
        (err.kind === 'network' || err.kind === 'server') &&
        attempt < 2;

      if (!canResume) throw err;

      // 指数退避后续读；此时服务端仍在生成或已生成完毕
      attempt += 1;
      resume = true;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    } finally {
      monitor?.dispose();
    }
  }
}
