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
    sessionId: string,
    message: string,
    model: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const token = localStorage.getItem('token') || '';
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.COMPLETIONS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId, message, model, stream: true }),
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
        if (signal?.aborted) return;
        callbacks.onError(readerError instanceof Error ? readerError.message : '流读取异常');
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
      }
    } catch (error) {
      if (signal?.aborted) return;
      callbacks.onError(error instanceof Error ? error.message : '未知错误');
    }
  }

  async fetchAIConfig(): Promise<{
    provider: string;
    model: string;
    prompt: string;
  } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.SYSTEM.MODELS}`);
      if (response.ok) {
        const models = await response.json();
        if (Array.isArray(models) && models.length > 0) {
          return {
            provider: 'openai',
            model: models[0].id || 'gpt-4o-mini',
            prompt: '',
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async callLLM(
    config: { provider: string; model: string; prompt: string },
    userInput: string,
  ): Promise<{ content: string; error?: string }> {
    try {
      const token = localStorage.getItem('token') || '';
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.COMPLETIONS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: userInput,
          model: config.model,
          systemPrompt: config.prompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        return { content: '', error: `请求失败(${response.status}): ${errorText}` };
      }

      const data = await response.json();
      return { content: data.content || data.response || JSON.stringify(data) };
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : '请求失败',
      };
    }
  }
}

const llmServiceInstance = LLMService.getInstance();
export default llmServiceInstance;
