import type { AIConfig, TestResult } from './types';
import { API_ENDPOINTS } from '@shared/api/endpoints';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const adminApi = {
  async fetchConfig(): Promise<AIConfig | null> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AI_CONFIG.LATEST}`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('获取配置失败:', error);
      return null;
    }
  },

  async testConnection(config: Partial<AIConfig>): Promise<TestResult> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AI_CONFIG.TEST}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: config.apiKey?.trim(),
          provider: config.provider,
          model: config.model,
        }),
      });
      const result = await response.json();
      return result;
    } catch (error) {
      return {
        message: '连接失败',
        error: error instanceof Error ? error.message : '网络错误，请检查后端服务',
      };
    }
  },

  async saveConfig(config: AIConfig): Promise<{ id: number } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AI_CONFIG.SAVE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('保存配置失败:', error);
      return null;
    }
  },
};

export const configCache = {
  get(): AIConfig | null {
    try {
      const saved = localStorage.getItem('aiConfig');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  },

  set(config: AIConfig): void {
    try {
      localStorage.setItem('aiConfig', JSON.stringify(config));
    } catch (error) {
      console.error('缓存配置失败:', error);
    }
  },

  clear(): void {
    localStorage.removeItem('aiConfig');
  },
};
