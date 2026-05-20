import { CONVERSATION_SCRIPT, PHASE_NAMES, PHASE_LABELS } from '../scripts/conversation';
import type { ChatStrategy, ChatStrategyResult, ChatMessage } from './types';

let msgIdCounter = 0;
function nextId(): string {
  return `msg_${++msgIdCounter}_${Date.now()}`;
}

function createMessage(
  content: string,
  isUser: boolean,
  type: ChatMessage['type'] = 'text',
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: nextId(),
    content,
    isUser,
    type,
    timestamp: Date.now(),
    ...extra,
  };
}

/**
 * 脚本模式：使用本地硬编码对话脚本驱动对话
 * 适用于 MVP 阶段和离线演示
 */
export class ScriptStrategy implements ChatStrategy {
  private step = 0;
  private currentPhase = 0;

  getCurrentPhase(): number {
    return this.currentPhase;
  }

  getPhaseName(): string {
    return PHASE_NAMES[this.currentPhase] + '中';
  }

  getPhaseLabel(): string {
    return PHASE_LABELS[this.currentPhase];
  }

  async start(): Promise<ChatStrategyResult> {
    this.step = 0;
    this.currentPhase = 0;
    return this.playStep();
  }

  async selectReply(_text: string): Promise<ChatStrategyResult | null> {
    this.step++;
    if (this.step >= CONVERSATION_SCRIPT.length) return null;
    return this.playStep();
  }

  async sendMessage(_text: string): Promise<ChatStrategyResult | null> {
    this.step++;
    if (this.step >= CONVERSATION_SCRIPT.length) {
      return {
        message: createMessage('任何时候想继续聊，我都在这里 🤝', false),
        quickReplies: [],
        phase: this.currentPhase,
      };
    }
    return this.playStep();
  }

  async acceptInsight(_messageId: string): Promise<ChatStrategyResult | null> {
    this.step++;
    if (this.step >= CONVERSATION_SCRIPT.length) return null;
    return this.playStep();
  }

  async reviseInsight(_messageId: string, _feedback: string): Promise<ChatStrategyResult | null> {
    this.step++;
    if (this.step >= CONVERSATION_SCRIPT.length) return null;
    return this.playStep();
  }

  async selectAction(_title: string): Promise<ChatStrategyResult> {
    return {
      message: createMessage(
        '很好的选择！这个方向最大的优势是：你不需要辞职就能开始。\n\n你可以每周投入5-10小时，先建立你的技术内容体系。3个月后回看，你会发现自己的影响力已经在悄悄增长。\n\n要不要我把具体的起步计划整理给你？',
        false,
      ),
      quickReplies: [],
      phase: this.currentPhase,
    };
  }

  reset(): void {
    this.step = 0;
    this.currentPhase = 0;
  }

  private playStep(): ChatStrategyResult {
    const step = CONVERSATION_SCRIPT[this.step];
    if (!step) {
      return {
        message: createMessage('对话已结束', false),
        quickReplies: [],
        phase: this.currentPhase,
      };
    }

    if (step.nextPhase !== undefined) {
      this.currentPhase = step.nextPhase;
    }

    const message = createMessage(step.agent, false, step.type || 'text', {
      insightData: step.insightData,
      actionData: step.actionData,
    });

    const quickReplies = step.options ? [...step.options, '✍️ 我想自己说'] : [];

    return { message, quickReplies, phase: this.currentPhase };
  }
}
