// 共享 Hooks

import { useState, useEffect, useRef } from 'react';
import type { AIConfig, TestStatus, SaveStatus, TestResult, PromptModule } from './types';
import { getModuleName } from '@shared/utils';
import { adminApi, configCache } from './api';

// AI 配置相关的 hooks
export function useAIConfig() {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isConnectionValid, setIsConnectionValid] = useState(false);
  const [configId, setConfigId] = useState<number | null>(null);

  // 初始化加载配置
  useEffect(() => {
    const loadConfig = async () => {
      const config = await adminApi.fetchConfig();
      if (config) {
        setConfigId(config.id ?? null);
        setApiKey(config.apiKey || '');
        setProvider(config.provider || '');
        setModel(config.model || '');
        if (config.lastTestTime && config.lastTestResult) {
          setIsConnectionValid(true);
          setTestResult({ message: config.lastTestResult, responseTime: 0 });
        }
        configCache.set(config);
      } else {
        // 尝试从缓存加载
        const cached = configCache.get();
        if (cached) {
          setApiKey(cached.apiKey || '');
          setProvider(cached.provider || '');
          setModel(cached.model || '');
        }
      }
    };
    loadConfig();
  }, []);

  const isConfigValid = (): boolean => !!(apiKey.trim() && provider && model);

  const handleTestConnection = async () => {
    if (!isConfigValid()) {
      alert('请先填写完整的配置信息（API Key、服务商、模型）');
      return;
    }

    setTestStatus('testing');
    setTestResult(null);

    const result = await adminApi.testConnection({ apiKey, provider, model });

    if (result.success) {
      setTestStatus('success');
      setTestResult(result);
      setIsConnectionValid(true);
    } else {
      setTestStatus('error');
      setTestResult(result);
      setIsConnectionValid(false);
    }
  };

  const handleSaveConfig = async (prompt: string = '') => {
    if (!isConfigValid()) {
      alert('配置信息不完整');
      return;
    }

    setSaveStatus('saving');

    const lastTestResultStr = typeof testResult?.message === 'string' 
      ? testResult.message 
      : String(testResult?.message || '');

    const configData: AIConfig = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt,
      lastTestInput: '连接测试',
      lastTestResult: lastTestResultStr,
      lastTestTime: new Date().toISOString(),
    };

    const saved = await adminApi.saveConfig(configData);

    if (saved) {
      setConfigId(saved.id);
      configCache.set({
        apiKey: apiKey.trim(),
        provider,
        model,
        prompt,
      });
      setSaveStatus('saved');
      alert('配置保存成功！');
    } else {
      setSaveStatus('error');
      alert('保存失败，请重试');
    }
  };

  return {
    apiKey, setApiKey,
    provider, setProvider,
    model, setModel,
    testStatus, testResult, isConnectionValid,
    saveStatus, configId,
    isConfigValid,
    handleTestConnection,
    handleSaveConfig,
  };
}

// Prompt 管理相关的 hooks
export function usePromptManagement() {
  const [prompts, setPrompts] = useState<Record<PromptModule, string>>({
    perception: '',
    retrieval: '',
    generation: '',
    evaluation: '',
    'global-settings': '',
  });
  const [activeModule, setActiveModule] = useState<PromptModule>('perception');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // 用于跟踪当前编辑的全局Prompt ID（用于更新操作）
  const [editingGlobalPromptId, setEditingGlobalPromptId] = useState<number | null>(null);

  const handlePromptChange = (module: PromptModule, value: string) => {
    setPrompts((prev) => ({ ...prev, [module]: value }));
  };

  // 当模块切换时，重置编辑状态
  const handleModuleChange = (module: PromptModule) => {
    setActiveModule(module);
    // 切换模块时重置编辑的GlobalPrompt ID，确保不会误更新
    if (module !== 'global-settings') {
      setEditingGlobalPromptId(null);
    }
  };

  // 加载在线的全局Prompt（用于编辑已有Prompt）
  const loadOnlineGlobalPrompt = async () => {
    try {
      const { globalPromptApi } = await import('./globalPrompt/api');
      const onlinePrompt = await globalPromptApi.getOnlinePrompt();
      
      if (onlinePrompt) {
        // 加载到编辑器中
        setPrompts(prev => ({
          ...prev,
          'global-settings': onlinePrompt.templateContent,
        }));
        // 设置编辑ID，后续保存时使用更新操作
        setEditingGlobalPromptId(onlinePrompt.id);
        console.log(`已加载在线Prompt: ${onlinePrompt.name} (ID: ${onlinePrompt.id})`);
        return onlinePrompt;
      }
      
      return null;
    } catch (error) {
      console.error('加载在线Prompt失败:', error);
      return null;
    }
  };

  const handleSavePrompt = async (
    module: PromptModule,
    apiKey: string,
    provider: string,
    model: string,
    testResult: TestResult | null
  ) => {
    const promptText = prompts[module];
    if (!promptText.trim()) {
      alert('请填写提示词内容');
      return;
    }

    setSaveStatus('saving');

    // 🔧 修复：全局Prompt保存到GlobalPrompt表，而不是AIConfig表
    if (module === 'global-settings') {
      try {
        // 动态导入 globalPromptApi，避免循环依赖
        const { globalPromptApi } = await import('./globalPrompt/api');
        
        // 如果有正在编辑的ID，则更新；否则创建新的
        if (editingGlobalPromptId) {
          // 更新现有Prompt
          const updatedPrompt = await globalPromptApi.updatePrompt(editingGlobalPromptId, {
            templateContent: promptText.trim(),
            createdBy: 'admin', // 可以从用户上下文获取
          });
          
          setSaveStatus('saved');
          alert(`${getModuleName(module)}更新成功！版本: v${updatedPrompt.version}`);
        } else {
          // 创建新Prompt
          const newPrompt = await globalPromptApi.createPrompt({
            name: `global_prompt_${Date.now()}`, // 生成唯一名称
            templateContent: promptText.trim(),
            createdBy: 'admin', // 可以从用户上下文获取
          });
          
          // 保存新创建的ID，下次保存时使用更新操作
          setEditingGlobalPromptId(newPrompt.id);
          setSaveStatus('saved');
          alert(`${getModuleName(module)}创建成功！`);
        }
      } catch (error) {
        setSaveStatus('error');
        const errorMsg = error instanceof Error ? error.message : '保存失败，请重试';
        alert(errorMsg);
        console.error('保存全局Prompt失败:', error);
      }
    } else {
      // 其他模块的prompt保存到AIConfig表（保持原有逻辑）
      const configData: AIConfig = {
        apiKey: apiKey.trim(),
        provider,
        model,
        prompt: promptText.trim(),
        lastTestInput: '连接测试',
        lastTestResult: testResult?.message || '',
        lastTestTime: new Date().toISOString(),
      };

      const saved = await adminApi.saveConfig(configData);

      if (saved) {
        configCache.set(configData);
        setSaveStatus('saved');
        alert(`${getModuleName(module)}提示词保存成功！`);
      } else {
        setSaveStatus('error');
        alert('保存失败，请重试');
      }
    }
  };

  return {
    prompts,
    activeModule,
    setActiveModule: handleModuleChange,
    saveStatus,
    isFullscreen,
    setIsFullscreen,
    handlePromptChange,
    handleSavePrompt,
    editingGlobalPromptId,
    setEditingGlobalPromptId,
    loadOnlineGlobalPrompt,
  };
}

// 下拉菜单外部点击 hook
export function useClickOutside<T extends HTMLElement>(
  callback: () => void
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [callback]);

  return ref;
}
