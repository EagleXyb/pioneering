import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LlmService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaultConfig();
  }

  // ========== 配置管理 ==========

  private async ensureDefaultConfig() {
    const config = await this.prisma.aiConfig.findFirst();
    if (!config) {
      await this.prisma.aiConfig.create({
        data: {
          apiKey: 'sk-ec0ae98e1dfb45a4be0a081cb3e9aa87',
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          prompt: `你是一个有用的AI助手。请遵循以下 Markdown 输出规范：
1. 标题层级：只使用 ### 三级标题，简洁不突兀
2. 列表：统一使用 - 无序列表，不使用数字列表
3. 重点强调：只使用 **加粗**，不使用斜体、删除线
4. 段落间距：段落之间空一行，列表项之间不空行
5. 不使用换行符，全部靠 Markdown 自动换行
6. 少量使用 ✅ ✨ 📌 等简洁图标提升可读性
7. 排版简洁、清晰、重点突出，避免冗余格式`,
        },
      });
    } else if (!config.apiKey) {
      await this.prisma.aiConfig.update({
        where: { id: config.id },
        data: { apiKey: 'sk-ec0ae98e1dfb45a4be0a081cb3e9aa87' },
      });
    }
  }

  async findLatest() {
    return this.prisma.aiConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });
  }

  // ========== model → provider 映射 ==========

  private readonly MODEL_TO_PROVIDER: Record<string, string> = {
    'deepseek-v4-flash': 'deepseek',
    'deepseek-v4-pro': 'deepseek',
    'glm-5.1': 'glm',
    'glm-5v-turbo': 'glm',
    'glm-5.0-turbo': 'glm',
    'kimi-k2.6': 'kimi',
    'kimi-k2.5': 'kimi',
    'MiniMax-M2.7': 'minimax',
    'MiniMax-M2.5': 'minimax',
    'qwen-3.6plus': 'qwen',
  };

  private resolveProvider(model: string, fallback: string): string {
    return this.MODEL_TO_PROVIDER[model] || fallback;
  }

  // ========== 非流式调用 ==========

  async callNonStream(
    messages: { role: string; content: string }[],
    overrideModel?: string,
  ): Promise<{ content: string; model: string }> {
    const config = await this.findLatest();
    if (!config || !config.apiKey) {
      throw new BadRequestException('AI 配置不完整，请先配置 API Key');
    }

    const model = overrideModel || config.model;
    const apiKey = config.apiKey;
    const provider = this.resolveProvider(model, config.provider);

    let url: string;
    let body: any;

    if (provider === 'qwen') {
      url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
      body = {
        model,
        input: { messages },
        parameters: { temperature: 0.7 },
      };
    } else {
      const baseUrls: Record<string, string> = {
        deepseek: 'https://api.deepseek.com/v1/chat/completions',
        glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        kimi: 'https://api.moonshot.cn/v1/chat/completions',
        minimax: 'https://api.minimaxi.com/v1/chat/completions',
      };
      url = baseUrls[provider] || baseUrls['deepseek'];
      body = {
        model: provider === 'minimax' && !model.includes('MiniMax-') ? `MiniMax-${model}` : model,
        messages,
        temperature: 0.7,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new BadRequestException(
        `LLM API 请求失败: ${response.status} - ${JSON.stringify(errorData)}`,
      );
    }

    const data = await response.json();

    let content = '';
    if (provider === 'qwen') {
      content = data.output?.text || data.output?.choices?.[0]?.message?.content || '';
    } else {
      content = data.choices?.[0]?.message?.content || '';
    }

    if (!content) {
      throw new BadRequestException('LLM API 返回空内容');
    }

    return { content, model };
  }

  // ========== 流式调用（AG-UI 协议） ==========

  /** 写一条 AG-UI 事件到 SSE 响应流 */
  private writeAGUIEvent(res: any, event: Record<string, any>) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.flush?.();
  }

  async streamChat(
    messages: { role: string; content: string }[],
    res: any,
    assistantMsgId: string,
    overrideProvider?: string,
    overrideModel?: string,
  ) {
    const config = await this.findLatest();
    if (!config || !config.apiKey) {
      this.writeAGUIEvent(res, { type: 'RUN_ERROR', message: '配置不完整，请检查API Key', code: 'CONFIG_ERROR' });
      res.end();
      return;
    }

    const model = overrideModel || config.model;
    const provider = overrideProvider || this.resolveProvider(model, config.provider);
    const apiKey = config.apiKey;

    if (!provider || !model) {
      this.writeAGUIEvent(res, { type: 'RUN_ERROR', message: '配置不完整，请检查服务商和模型', code: 'CONFIG_ERROR' });
      res.end();
      return;
    }

    const allMessages: { role: string; content: string }[] = [];
    if (config.prompt && config.prompt.trim()) {
      allMessages.push({ role: 'system', content: config.prompt });
    }
    allMessages.push(...messages);

    try {
      switch (provider) {
        case 'deepseek':
          await this.streamOpenAICompatible(
            'https://api.deepseek.com/v1/chat/completions', model, apiKey, allMessages, res, assistantMsgId,
          );
          break;
        case 'glm':
          await this.streamOpenAICompatible(
            'https://open.bigmodel.cn/api/paas/v4/chat/completions', model, apiKey, allMessages, res, assistantMsgId,
          );
          break;
        case 'kimi':
          await this.streamOpenAICompatible(
            'https://api.moonshot.cn/v1/chat/completions', model, apiKey, allMessages, res, assistantMsgId,
          );
          break;
        case 'qwen':
          await this.streamQwen(model, apiKey, allMessages, res, assistantMsgId);
          break;
        case 'minimax': {
          const minimaxModel = model.includes('MiniMax-') ? model : `MiniMax-${model}`;
          await this.streamOpenAICompatible(
            'https://api.minimaxi.com/v1/chat/completions', minimaxModel, apiKey, allMessages, res, assistantMsgId,
          );
          break;
        }
        default:
          this.writeAGUIEvent(res, { type: 'RUN_ERROR', message: `不支持的服务商: ${provider}`, code: 'UNSUPPORTED_PROVIDER' });
          res.end();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      this.writeAGUIEvent(res, { type: 'RUN_ERROR', message: errorMsg, code: 'STREAM_ERROR' });
      res.end();
    }
  }

  // ========== 私有：流式底层实现（AG-UI 格式） ==========

  /**
   * 处理 OpenAI 兼容 API 的 SSE 流，输出 AG-UI 协议事件
   *
   * 事件顺序：
   *   (可选) THINKING_START → THINKING_TEXT_MESSAGE_CONTENT* → THINKING_END
   *   (可选) TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END
   */
  private async streamOpenAICompatible(
    url: string,
    model: string,
    apiKey: string,
    messages: { role: string; content: string }[],
    res: any,
    assistantMsgId: string,
  ) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, stream: true }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API请求失败: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    if (!response.body) {
      throw new Error('无法读取响应流');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let textMsgStarted = false;
    let thinkStarted = false;

    /** 确保 TEXT_MESSAGE_START 已发送 */
    const ensureTextStart = () => {
      if (!textMsgStarted) {
        this.writeAGUIEvent(res, {
          type: 'TEXT_MESSAGE_START',
          messageId: assistantMsgId,
          role: 'assistant',
        });
        textMsgStarted = true;
      }
    };

    /** 确保 THINKING_START 已发送 */
    const ensureThinkStart = () => {
      if (!thinkStarted) {
        this.writeAGUIEvent(res, { type: 'THINKING_START' });
        thinkStarted = true;
      }
    };

    /** 清理结束状态：发送所有未结束的标记 */
    const flushEndEvents = () => {
      if (thinkStarted) {
        this.writeAGUIEvent(res, { type: 'THINKING_END' });
        thinkStarted = false;
      }
      if (textMsgStarted) {
        this.writeAGUIEvent(res, { type: 'TEXT_MESSAGE_END', messageId: assistantMsgId });
        textMsgStarted = false;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === ':') continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              flushEndEvents();
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta || {};
              const reasoningContent = delta.reasoning_content || '';
              const content = delta.content || '';

              // 1) 处理思考内容
              if (reasoningContent) {
                ensureThinkStart();
                this.writeAGUIEvent(res, {
                  type: 'THINKING_TEXT_MESSAGE_CONTENT',
                  delta: reasoningContent,
                });
              }

              // 2) 处理文本内容
              if (content) {
                // 如果前面有思考块，先闭合它
                if (thinkStarted) {
                  // 有 reasoning_content 的 case：内容在思考结束后输出
                  if (!reasoningContent) {
                    this.writeAGUIEvent(res, { type: 'THINKING_END' });
                    thinkStarted = false;
                  }
                }
                // 有 reasoning_content 但没闭合 → 说明是 DeepSeek 的并行输出
                if (thinkStarted) {
                  this.writeAGUIEvent(res, { type: 'THINKING_END' });
                  thinkStarted = false;
                }
                ensureTextStart();
                this.writeAGUIEvent(res, {
                  type: 'TEXT_MESSAGE_CONTENT',
                  messageId: assistantMsgId,
                  delta: content,
                });
              }

              // 3) 既无 reasoning_content 也无 content → 可能是 think 标签内嵌
              if (!reasoningContent && !content) {
                // 部分模型输出空 delta，跳过
              }
            } catch {
              continue;
            }
          }
        }
      }
      // 流结束
      flushEndEvents();
      res.end();
    } finally {
      reader.releaseLock();
    }
  }

  private async streamQwen(
    model: string,
    apiKey: string,
    messages: { role: string; content: string }[],
    res: any,
    assistantMsgId: string,
  ) {
    const response = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-DashScope-SSE': 'enable',
        },
        body: JSON.stringify({
          model,
          input: { messages },
          parameters: { temperature: 0.7, incremental_output: true },
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Qwen API请求失败: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    if (!response.body) {
      throw new Error('无法读取响应流');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let textMsgStarted = false;
    let thinkStarted = false;
    let hasReasoningOutput = false;

    const ensureTextStart = () => {
      if (!textMsgStarted) {
        this.writeAGUIEvent(res, {
          type: 'TEXT_MESSAGE_START',
          messageId: assistantMsgId,
          role: 'assistant',
        });
        textMsgStarted = true;
      }
    };

    const ensureThinkStart = () => {
      if (!thinkStarted) {
        this.writeAGUIEvent(res, { type: 'THINKING_START' });
        thinkStarted = true;
      }
    };

    const flushEndEvents = () => {
      if (thinkStarted) {
        this.writeAGUIEvent(res, { type: 'THINKING_END' });
        thinkStarted = false;
      }
      if (textMsgStarted) {
        this.writeAGUIEvent(res, { type: 'TEXT_MESSAGE_END', messageId: assistantMsgId });
        textMsgStarted = false;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === ':') continue;

          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              flushEndEvents();
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.output?.choices?.[0];
              const reasoningContent = choice?.message?.reasoning_content || '';
              const content = choice?.message?.content || '';

              if (reasoningContent) {
                hasReasoningOutput = true;
                ensureThinkStart();
                this.writeAGUIEvent(res, {
                  type: 'THINKING_TEXT_MESSAGE_CONTENT',
                  delta: reasoningContent,
                });
              }

              if (content) {
                if (hasReasoningOutput && !reasoningContent) {
                  // 思考结束后首次输出文本
                  if (thinkStarted) {
                    this.writeAGUIEvent(res, { type: 'THINKING_END' });
                    thinkStarted = false;
                  }
                }
                ensureTextStart();
                this.writeAGUIEvent(res, {
                  type: 'TEXT_MESSAGE_CONTENT',
                  messageId: assistantMsgId,
                  delta: content,
                });
              }
            } catch {
              continue;
            }
          }
        }
      }
      flushEndEvents();
      res.end();
    } finally {
      reader.releaseLock();
    }
  }
}
