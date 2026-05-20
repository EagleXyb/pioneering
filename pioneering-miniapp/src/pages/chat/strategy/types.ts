import type { InsightData, ActionData } from '../scripts/conversation';

// ====== 对话策略接口 ======
// 不同模式（脚本 / AI）实现此接口，hook 层无需关心底层实现

export interface ChatMessage {
  id: string;
  content: string;
  isUser: boolean;
  type: 'text' | 'insight' | 'action';
  insightData?: InsightData;
  actionData?: ActionData;
  timestamp: number;
}

export interface ChatStrategyResult {
  message: ChatMessage;
  quickReplies: string[];
  phase: number;
}

export interface ChatStrategy {
  /** 开始对话 */
  start(): Promise<ChatStrategyResult>;

  /** 用户选择快捷回复 */
  selectReply(text: string): Promise<ChatStrategyResult | null>;

  /** 用户自由输入 */
  sendMessage(text: string): Promise<ChatStrategyResult | null>;

  /** 接受洞察 */
  acceptInsight(messageId: string): Promise<ChatStrategyResult | null>;

  /** 修正洞察 */
  reviseInsight(messageId: string, feedback: string): Promise<ChatStrategyResult | null>;

  /** 选择行动 */
  selectAction(title: string): Promise<ChatStrategyResult | null>;

  /** 重置对话 */
  reset(): void;
}
