// 共享 Hooks

import { useState, useEffect, useRef } from 'react';
import { AIConfig, TestStatus, SaveStatus, TestResult, PromptModule } from './types';
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

    const configData: AIConfig = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt,
      lastTestInput: '连接测试',
      lastTestResult: testResult?.message || '',
      lastTestTime: new Date().toISOString(),
    };

    const saved = await adminApi.saveConfig(configData);

    if (saved) {
      setConfigId(saved.id);
      configCache.set(configData);
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

  const handlePromptChange = (module: PromptModule, value: string) => {
    setPrompts((prev) => ({ ...prev, [module]: value }));
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
  };

  return {
    prompts,
    activeModule,
    setActiveModule,
    saveStatus,
    isFullscreen,
    setIsFullscreen,
    handlePromptChange,
    handleSavePrompt,
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

// 工具函数
export function getModuleName(module: PromptModule): string {
  const names: Record<PromptModule, string> = {
    perception: '问题感知模块',
    retrieval: '知识检索模块',
    generation: '创意生成模块',
    evaluation: '评估反馈模块',
    'global-settings': '全局设置',
  };
  return names[module];
}
