// 全局Prompt业务逻辑Hook

import { useState, useEffect, useCallback } from 'react';
import { globalPromptApi } from './api';
import type {
  GlobalPrompt,
  CreatePromptData,
  UpdatePromptData,
  UseGlobalPromptReturn,
} from './types';

export function useGlobalPrompt(): UseGlobalPromptReturn {
  const [prompts, setPrompts] = useState<GlobalPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentEditingPrompt, setCurrentEditingPrompt] = useState<GlobalPrompt | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // 加载Prompt列表
  const fetchPrompts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await globalPromptApi.getAllPrompts();
      setPrompts(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载Prompt列表失败';
      setError(errorMessage);
      console.error('Error fetching prompts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 上线Prompt
  const handleOnline = useCallback(async (id: number) => {
    try {
      const updatedPrompt = await globalPromptApi.updatePromptStatus(id, { status: 'online' });
      setPrompts(prev => prev.map(p => p.id === id ? updatedPrompt : p));
      return updatedPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '上线失败，请检查网络连接';
      setError(errorMessage);
      console.error('Error setting prompt online:', err);
      return null;
    }
  }, []);

  // 下线Prompt
  const handleOffline = useCallback(async (id: number) => {
    try {
      const updatedPrompt = await globalPromptApi.updatePromptStatus(id, { status: 'offline' });
      setPrompts(prev => prev.map(p => p.id === id ? updatedPrompt : p));
      return updatedPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '下线失败，请检查网络连接';
      setError(errorMessage);
      console.error('Error setting prompt offline:', err);
      return null;
    }
  }, []);

  // 删除Prompt
  const handleDelete = useCallback(async (id: number) => {
    try {
      await globalPromptApi.deletePrompt(id);
      setPrompts(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '删除失败，请检查网络连接';
      setError(errorMessage);
      console.error('Error deleting prompt:', err);
    }
  }, []);

  // 创建Prompt
  const handleCreate = useCallback(async (data: CreatePromptData): Promise<GlobalPrompt | null> => {
    try {
      const newPrompt = await globalPromptApi.createPrompt(data);
      setPrompts(prev => [...prev, newPrompt]);
      return newPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '创建失败，请检查网络连接';
      setError(errorMessage);
      console.error('Error creating prompt:', err);
      return null;
    }
  }, []);

  // 更新Prompt
  const handleUpdate = useCallback(async (id: number, data: UpdatePromptData): Promise<GlobalPrompt | null> => {
    try {
      const updatedPrompt = await globalPromptApi.updatePrompt(id, data);
      setPrompts(prev => prev.map(p => p.id === id ? updatedPrompt : p));
      return updatedPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '更新失败，请检查网络连接';
      setError(errorMessage);
      console.error('Error updating prompt:', err);
      return null;
    }
  }, []);

  // 更新Prompt状态
  const handleUpdateStatus = useCallback(async (id: number, status: 'online' | 'offline'): Promise<GlobalPrompt | null> => {
    try {
      const updatedPrompt = await globalPromptApi.updatePromptStatus(id, { status });
      setPrompts(prev => prev.map(p => p.id === id ? updatedPrompt : p));
      return updatedPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '状态更新失败，请检查网络连接';
      setError(errorMessage);
      console.error('Error updating prompt status:', err);
      return null;
    }
  }, []);

  // 更新审批状态
  const handleUpdateApproval = useCallback(async (id: number, approvalStatus: 'pending' | 'approved' | 'rejected'): Promise<GlobalPrompt | null> => {
    try {
      const updatedPrompt = await globalPromptApi.updatePromptApproval(id, { approvalStatus });
      setPrompts(prev => prev.map(p => p.id === id ? updatedPrompt : p));
      return updatedPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '审批状态更新失败，请检查网络连接';
      setError(errorMessage);
      console.error('Error updating prompt approval:', err);
      return null;
    }
  }, []);

  // 进入编辑模式
  const enterEditMode = useCallback((prompt: GlobalPrompt) => {
    setCurrentEditingPrompt(prompt);
    setIsEditing(true);
  }, []);

  // 退出编辑模式
  const exitEditMode = useCallback(() => {
    setCurrentEditingPrompt(null);
    setIsEditing(false);
  }, []);

  // 初始加载
  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  return {
    prompts,
    loading,
    error,
    fetchPrompts,
    handleOnline,
    handleOffline,
    handleDelete,
    handleCreate,
    handleUpdate,
    handleUpdateStatus,
    handleUpdateApproval,
    currentEditingPrompt,
    isEditing,
    enterEditMode,
    exitEditMode,
  };
}