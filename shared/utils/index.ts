export function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^1[3-9]\d{9}$/;
  return phoneRegex.test(phone.replace(/[-\s]/g, ''));
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function getProviderName(providerId: string): string {
  const names: Record<string, string> = {
    deepseek: 'DeepSeek',
    glm: 'GLM',
    minimax: 'MiniMax',
    kimi: 'Kimi',
    qwen: 'Qwen',
  };
  return names[providerId] || providerId;
}

export function getModuleName(module: string): string {
  const names: Record<string, string> = {
    perception: '问题感知模块',
    retrieval: '知识检索模块',
    generation: '创意生成模块',
    evaluation: '评估反馈模块',
    'global-settings': '全局设置',
  };
  return names[module] || module;
}

export function filterThinkingChain(content: string): string {
  if (!content) return '';
  
  let filtered = content;
  
  filtered = filtered.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  return filtered.trim();
}

export function extractThinkingChain(content: string): string | null {
  if (!content) return null;
  
  const match = content.match(/<think>([\s\S]*?)<\/think>/i);
  return match ? match[1].trim() : null;
}
