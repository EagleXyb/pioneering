import Taro from '@tarojs/taro';
import type { SSEParams, SSEConnection, SSEChunk } from '@/types/chat';

// ====== SSE 配置 ======
const SSE_CONFIG = {
  timeout: 15000,        // 15s 无数据则超时
  maxRetries: 3,         // 最多重连 3 次
  retryBaseDelay: 1000,  // 重试基础间隔 1s
};

// ====== 解析 SSE 数据行 ======
function parseSSELine(line: string): SSEChunk | null {
  if (!line.startsWith('data: ')) return null;

  const raw = line.slice(6).trim();
  if (raw === '[DONE]') return { type: 'done', data: '' };

  try {
    const parsed = JSON.parse(raw);
    return {
      type: parsed.type || 'content',
      data: parsed.data || parsed.content || raw,
    };
  } catch {
    // 非 JSON 格式，当作纯文本 content
    if (raw.startsWith('<thinking>') && raw.includes('</thinking>')) {
      const thinkMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
      if (thinkMatch) {
        return { type: 'thinking', data: thinkMatch[1] };
      }
    }
    return { type: 'content', data: raw };
  }
}

// ====== 创建 SSE 连接 ======
export function connectSSE(params: SSEParams): SSEConnection {
  const { sessionId, content } = params;

  let chunkCallback: ((data: SSEChunk) => void) | null = null;
  let doneCallback: (() => void) | null = null;
  let errorCallback: ((err: Error) => void) | null = null;
  let aborted = false;
  let timer: ReturnType<typeof Taro.request> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  let buffer = '';

  function resetTimeout() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      if (!aborted) {
        doAbort();
        errorCallback?.(new Error('响应超时，请稍后重试'));
      }
    }, SSE_CONFIG.timeout);
  }

  function doAbort() {
    aborted = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (timer) {
      try { timer.abort(); } catch { /* ignore */ }
    }
  }

  function doRequest() {
    if (aborted) return;

    resetTimeout();

    timer = Taro.request({
      url: '/chat/completions',
      method: 'POST',
      enableChunked: true,
      header: { 'Content-Type': 'application/json' },
      data: {
        sessionId,
        message: content,
        stream: true,
      },
      success(res) {
        if (aborted) return;
        // 非流式回退：整包处理
        if (res.statusCode === 200 && !res.data) {
          doneCallback?.();
          return;
        }
      },
      fail(err) {
        if (aborted) return;
        // 指数退避重试
        if (retryCount < SSE_CONFIG.maxRetries) {
          retryCount++;
          const delay = SSE_CONFIG.retryBaseDelay * Math.pow(2, retryCount - 1);
          setTimeout(doRequest, delay);
          return;
        }
        errorCallback?.(new Error(err.errMsg || '网络请求失败'));
      },
    });

    // 监听分块数据（Taro enableChunked 回调）
    if (timer && 'onChunkReceived' in timer) {
      (timer as any).onChunkReceived((res: { data: ArrayBuffer }) => {
        if (aborted) return;
        resetTimeout();

        const text = arrayBufferToString(res.data);
        buffer += text;

        // 按行解析 SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 最后一个不完整行保留

        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = parseSSELine(line);
          if (chunk) {
            if (chunk.type === 'done') {
              doAbort();
              doneCallback?.();
              return;
            }
            chunkCallback?.(chunk);
          }
        }
      });
    }
  }

  // 启动首次请求
  doRequest();

  return {
    abort: () => {
      doAbort();
    },
    onChunk: (callback) => {
      chunkCallback = callback;
    },
    onDone: (callback) => {
      doneCallback = callback;
    },
    onError: (callback) => {
      errorCallback = callback;
    },
  };
}

// ====== ArrayBuffer → 字符串 ======
function arrayBufferToString(buffer: ArrayBuffer): string {
  let result = '';
  const arr = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    result += String.fromCharCode.apply(null, Array.from(arr.slice(i, i + chunkSize)));
  }
  return decodeURIComponent(escape(result));
}