export interface AIConfig {
  id?: number;
  apiKey: string;
  provider: string;
  model: string;
  prompt: string;
  lastTestInput?: string;
  lastTestResult?: string;
  lastTestTime?: string;
}

export interface TestResult {
  message: string;
  responseTime?: number;
  error?: string;
  success?: boolean;
}

export type TestStatus = 'idle' | 'testing' | 'success' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface ProviderInfo {
  id: string;
  name: string;
  models: number;
  status: 'active' | 'inactive';
}

export interface ModelInfo {
  provider: string;
  name: string;
  id: string;
  status: 'active' | 'inactive';
}
