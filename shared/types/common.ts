export type NavSection = 'model' | 'prompt' | 'users' | 'security';
export type PromptModule = 'perception' | 'retrieval' | 'generation' | 'evaluation' | 'global-settings';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
