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
export const REQUEST_TIMEOUT = 60000;
