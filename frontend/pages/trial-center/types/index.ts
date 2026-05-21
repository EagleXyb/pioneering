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
