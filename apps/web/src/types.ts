export type AppMode = 'chat' | 'pro' | 'task';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ProcessStep {
  stepNumber: number;
  type: 'thinking' | 'tool' | 'observation' | 'answer';
  label: string;
  badge: string;
  expanded: boolean;
  detail?: {
    type: 'text' | 'code';
    label?: string;
    content: string;
    codeHead?: string;
  };
  loading?: boolean;
}