// 共享类型定义

// 导航相关
export type NavSection = 'model' | 'prompt' | 'security';
export type PromptModule = 'perception' | 'retrieval' | 'generation' | 'evaluation' | 'global-settings';
export type TestStatus = 'idle' | 'testing' | 'success' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

export interface NavSectionConfig {
  key: NavSection;
  label: string;
  items: NavItem[];
}

// AI 配置相关
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

// Prompt 模块信息
export interface PromptModuleInfo {
  title: string;
  description: string;
  placeholder: string;
}

// 服务商信息
export interface ProviderInfo {
  id: string;
  name: string;
  models: number;
  status: 'active' | 'inactive';
}

// 模型信息
export interface ModelInfo {
  provider: string;
  name: string;
  id: string;
  status: 'active' | 'inactive';
}

// 状态接口
export interface ModelManagementState {
  apiKey: string;
  provider: string;
  model: string;
  testStatus: TestStatus;
  testResult: TestResult | null;
  saveStatus: SaveStatus;
  isConnectionValid: boolean;
  configId: number | null;
}

export interface PromptManagementState {
  prompts: Record<PromptModule, string>;
  activeModule: PromptModule;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
}

export interface SecurityState {
  activeSection: string;
}
