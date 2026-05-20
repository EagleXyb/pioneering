import { chatApi } from '@/services';
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
 * AI 模式：通过后端 API 与 LLM 驱动对话
 * 适用于正式上线后接入真实 AI
 */
export class AIStrategy implements ChatStrategy {
  private sessionId = '';
  private currentPhase = 0;

  getCurrentPhase(): number {
    return this.currentPhase;
  }

  async start(): Promise<ChatStrategyResult> {
    const res = await chatApi.start('brainstorm');
    this.sessionId = res.sessionId;
    this.currentPhase = res.phase;

    return {
      message: createMessage(res.message.content, false, res.message.type, {
        insightData: res.message.insightData,
        actionData: res.message.actionData,
      }),
      quickReplies: res.quickReplies,
      phase: res.phase,
    };
  }

  async selectReply(text: string): Promise<ChatStrategyResult | null> {
    return this.sendToBackend(text);
  }

  async sendMessage(text: string): Promise<ChatStrategyResult | null> {
    return this.sendToBackend(text);
  }

  async acceptInsight(messageId: string): Promise<ChatStrategyResult | null> {
    if (!this.sessionId) return null;
    const res = await chatApi.acceptInsight(this.sessionId, messageId);
    this.currentPhase = res.phase;

    return {
      message: createMessage(res.message.content, false, res.message.type, {
        insightData: res.message.insightData,
        actionData: res.message.actionData,
      }),
      quickReplies: res.quickReplies,
      phase: res.phase,
    };
  }

  async reviseInsight(messageId: string, feedback: string): Promise<ChatStrategyResult | null> {
    if (!this.sessionId) return null;
    const res = await chatApi.reviseInsight(this.sessionId, messageId, feedback);
    this.currentPhase = res.phase;

    return {
      message: createMessage(res.message.content, false, res.message.type, {
        insightData: res.message.insightData,
        actionData: res.message.actionData,
      }),
      quickReplies: res.quickReplies,
      phase: res.phase,
    };
  }

  async selectAction(title: string): Promise<ChatStrategyResult | null> {
    if (!this.sessionId) return null;
    const res = await chatApi.selectAction(this.sessionId, title);
    this.currentPhase = res.phase;

    return {
      message: createMessage(res.message.content, false, res.message.type, {
        insightData: res.message.insightData,
        actionData: res.message.actionData,
      }),
      quickReplies: res.quickReplies,
      phase: res.phase,
    };
  }

  reset(): void {
    this.sessionId = '';
    this.currentPhase = 0;
  }

  private async sendToBackend(text: string): Promise<ChatStrategyResult | null> {
    if (!this.sessionId) return null;
    const res = await chatApi.sendMessage({
      sessionId: this.sessionId,
      content: text,
      isUser: true,
    });
    this.currentPhase = res.phase;

    return {
      message: createMessage(res.message.content, false, res.message.type, {
        insightData: res.message.insightData,
        actionData: res.message.actionData,
      }),
      quickReplies: res.quickReplies,
      phase: res.phase,
    };
  }
}
