import type { SensitiveFilterResult } from '@/types/chat';

// ====== 基础敏感词库（后续可扩展为远端配置或更完整词库） ======
const SENSITIVE_WORDS: string[] = [
  // 预留扩展位置
];

// ====== 敏感词过滤 ======
export function filterSensitive(input: string): SensitiveFilterResult {
  if (!input || !input.trim()) {
    return { passed: false, reason: '输入不能为空' };
  }

  const lower = input.toLowerCase();

  for (const word of SENSITIVE_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      return {
        passed: false,
        filtered: input.replace(new RegExp(word, 'gi'), '***'),
        reason: '输入内容包含敏感信息，请修改后重试',
      };
    }
  }

  return { passed: true };
}

// ====== 添加敏感词（运行时扩展） ======
export function addSensitiveWord(word: string): void {
  if (!SENSITIVE_WORDS.includes(word)) {
    SENSITIVE_WORDS.push(word);
  }
}