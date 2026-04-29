import { API_ENDPOINTS } from '@shared/api/endpoints';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamCallbacks {
  onChunk: (text: string, type?: 'thinking' | 'answer') => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export class LLMService {
  private static instance: LLMService;

  private constructor() {}

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  async streamChat(
    config: { apiKey: string; provider: string; model: string; prompt: string },
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AI_CONFIG.CHAT_STREAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, provider: config.provider, model: config.model }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('无法读取响应流');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          if (signal?.aborted) {
            reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === ':') continue;

            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);
              if (data === '[DONE]') {
                callbacks.onDone();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  callbacks.onError(parsed.error);
                  return;
                }
                if (parsed.type === 'done') {
                  callbacks.onDone();
                  return;
                }
                if (parsed.type === 'thinking') {
                  callbacks.onChunk(parsed.content, 'thinking');
                } else if (parsed.type === 'answer') {
                  callbacks.onChunk(parsed.content, 'answer');
                } else if (parsed.content) {
                  callbacks.onChunk(parsed.content);
                }
              } catch {
                continue;
              }
            }
          }
        }
        callbacks.onDone();
      } catch (readerError) {
        // abort 时静默退出，上层（useStreamChat）已自行处理超时/停止逻辑
        if (signal?.aborted) return;
        callbacks.onError(readerError instanceof Error ? readerError.message : '流读取异常');
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
      }
    } catch (error) {
      // abort 时静默退出，上层已处理
      if (signal?.aborted) return;
      callbacks.onError(error instanceof Error ? error.message : '未知错误');
    }
  }

  async fetchAIConfig(): Promise<{ apiKey: string; provider: string; model: string; prompt: string } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AI_CONFIG.LATEST}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.provider && data.model) {
          return {
            apiKey: '',
            provider: data.provider,
            model: data.model,
            prompt: data.prompt || '',
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

const llmServiceInstance = LLMService.getInstance();
export default llmServiceInstance;
