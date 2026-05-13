export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinkingContent?: string;
  answerContent?: string;
  status: 'loading' | 'success' | 'error' | 'block';
  error?: string;
  timestamp: number;
}

export const MAX_INPUT_LENGTH = 4000;
export const MAX_CONTEXT_MESSAGES = 20;
export const MAX_CONTEXT_TOKENS = 32000;
export const REQUEST_TIMEOUT = 60000;

export const MODEL_TO_PROVIDER: Record<string, string> = {
  'deepseek-v4-flash': 'deepseek',
  'deepseek-v4-pro': 'deepseek',
  'glm-5.1': 'glm',
  'glm-5v-turbo': 'glm',
  'glm-5.0-turbo': 'glm',
  'kimi-k2.6': 'kimi',
  'kimi-k2.5': 'kimi',
  'MiniMax-M2.7': 'minimax',
  'MiniMax-M2.5': 'minimax',
  'qwen-3.6plus': 'qwen',
};

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      tokens += 1;
    } else if (code > 127) {
      tokens += 1.5;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}
