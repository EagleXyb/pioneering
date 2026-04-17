import type { ReactNode } from 'react';

export type NavSection = 'model' | 'prompt' | 'users' | 'security';
export type PromptModule = 'perception' | 'retrieval' | 'generation' | 'evaluation' | 'global-settings';
export type TestStatus = 'idle' | 'testing' | 'success' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
}

export interface NavSectionConfig {
  key: NavSection;
  label: string;
  items: NavItem[];
}

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

export interface PromptModuleInfo {
  title: string;
  description: string;
  placeholder: string;
}

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
