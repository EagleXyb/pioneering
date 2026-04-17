// 全局Prompt API服务

import type {
  GlobalPrompt,
  CreatePromptData,
  UpdatePromptData,
  UpdateStatusData,
  UpdateApprovalData,
} from './types';
import { API_ENDPOINTS } from '@shared/api/endpoints';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

class GlobalPromptApi {
  async getAllPrompts(): Promise<GlobalPrompt[]> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BASE}`);
    if (!response.ok) {
      throw new Error(`获取Prompt列表失败: ${response.statusText}`);
    }
    return response.json();
  }

  async getPromptById(id: number): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BY_ID(id)}`);
    if (!response.ok) {
      throw new Error(`获取Prompt失败: ${response.statusText}`);
    }
    return response.json();
  }

  async getPromptByName(name: string): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BY_NAME(name)}`);
    if (!response.ok) {
      throw new Error(`获取Prompt失败: ${response.statusText}`);
    }
    return response.json();
  }

  async getOnlinePrompt(): Promise<GlobalPrompt | null> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.ONLINE}`);
    if (!response.ok) {
      throw new Error(`获取在线Prompt失败: ${response.statusText}`);
    }
    const data = await response.json();
    return data || null;
  }

  async createPrompt(data: CreatePromptData): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`创建Prompt失败: ${errorText || response.statusText}`);
    }
    return response.json();
  }

  async updatePrompt(id: number, data: UpdatePromptData): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BY_ID(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`更新Prompt失败: ${errorText || response.statusText}`);
    }
    return response.json();
  }

  async updatePromptStatus(id: number, data: UpdateStatusData): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.STATUS(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`更新Prompt状态失败: ${errorText || response.statusText}`);
    }
    return response.json();
  }

  async updatePromptApproval(id: number, data: UpdateApprovalData): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.APPROVAL(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`更新审批状态失败: ${errorText || response.statusText}`);
    }
    return response.json();
  }

  async deletePrompt(id: number): Promise<void> {
    const response = await fetch(`${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BY_ID(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`删除Prompt失败: ${errorText || response.statusText}`);
    }
  }

  async getPromptsByStatus(status?: string, approvalStatus?: string): Promise<GlobalPrompt[]> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (approvalStatus) params.append('approvalStatus', approvalStatus);

    const url = params.toString()
      ? `${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BASE}?${params.toString()}`
      : `${API_BASE}${API_ENDPOINTS.GLOBAL_PROMPT.BASE}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`获取Prompt列表失败: ${response.statusText}`);
    }
    return response.json();
  }
}

// 导出单例实例
export const globalPromptApi = new GlobalPromptApi();