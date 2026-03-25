// 全局Prompt API服务

import type {
  GlobalPrompt,
  CreatePromptData,
  UpdatePromptData,
  UpdateStatusData,
  UpdateApprovalData,
} from './types';

const API_BASE_URL = 'http://localhost:3000/api/global-prompt';

class GlobalPromptApi {
  // 获取所有Prompt
  async getAllPrompts(): Promise<GlobalPrompt[]> {
    const response = await fetch(API_BASE_URL);
    if (!response.ok) {
      throw new Error(`获取Prompt列表失败: ${response.statusText}`);
    }
    return response.json();
  }

  // 按ID获取Prompt
  async getPromptById(id: number): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE_URL}/${id}`);
    if (!response.ok) {
      throw new Error(`获取Prompt失败: ${response.statusText}`);
    }
    return response.json();
  }

  // 按名称获取Prompt
  async getPromptByName(name: string): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE_URL}/name/${encodeURIComponent(name)}`);
    if (!response.ok) {
      throw new Error(`获取Prompt失败: ${response.statusText}`);
    }
    return response.json();
  }

  // 获取在线的Prompt
  async getOnlinePrompt(): Promise<GlobalPrompt | null> {
    const response = await fetch(`${API_BASE_URL}/online`);
    if (!response.ok) {
      throw new Error(`获取在线Prompt失败: ${response.statusText}`);
    }
    const data = await response.json();
    return data || null;
  }

  // 创建Prompt
  async createPrompt(data: CreatePromptData): Promise<GlobalPrompt> {
    const response = await fetch(API_BASE_URL, {
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

  // 更新Prompt
  async updatePrompt(id: number, data: UpdatePromptData): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE_URL}/${id}`, {
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

  // 更新Prompt状态
  async updatePromptStatus(id: number, data: UpdateStatusData): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE_URL}/${id}/status`, {
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

  // 更新审批状态
  async updatePromptApproval(id: number, data: UpdateApprovalData): Promise<GlobalPrompt> {
    const response = await fetch(`${API_BASE_URL}/${id}/approval`, {
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

  // 删除Prompt
  async deletePrompt(id: number): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`删除Prompt失败: ${errorText || response.statusText}`);
    }
  }

  // 按状态筛选
  async getPromptsByStatus(status?: string, approvalStatus?: string): Promise<GlobalPrompt[]> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (approvalStatus) params.append('approvalStatus', approvalStatus);

    const url = params.toString() ? `${API_BASE_URL}?${params.toString()}` : API_BASE_URL;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`获取Prompt列表失败: ${response.statusText}`);
    }
    return response.json();
  }
}

// 导出单例实例
export const globalPromptApi = new GlobalPromptApi();