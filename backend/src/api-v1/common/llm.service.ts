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

  // ========== 流式调用 ==========

  async streamChat(
    messages: { role: string; content: string }[],
    res: any,
    overrideProvider?: string,
    overrideModel?: string,
  ) {
    const config = await this.findLatest();
    if (!config || !config.apiKey) {
      res.write(`data: ${JSON.stringify({ error: '配置不完整，请检查API Key' })}\n\n`);
      res.end();
      return;
    }

    const model = overrideModel || config.model;
    const provider = overrideProvider || this.resolveProvider(model, config.provider);
    const apiKey = config.apiKey;

    if (!provider || !model) {
      res.write(`data: ${JSON.stringify({ error: '配置不完整，请检查服务商和模型' })}\n\n`);
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
            'https://api.deepseek.com/v1/chat/completions', model, apiKey, allMessages, res,
          );
          break;
        case 'glm':
          await this.streamOpenAICompatible(
            'https://open.bigmodel.cn/api/paas/v4/chat/completions', model, apiKey, allMessages, res,
          );
          break;
        case 'kimi':
          await this.streamOpenAICompatible(
            'https://api.moonshot.cn/v1/chat/completions', model, apiKey, allMessages, res,
          );
          break;
        case 'qwen':
          await this.streamQwen(model, apiKey, allMessages, res);
          break;
        case 'minimax': {
          const minimaxModel = model.includes('MiniMax-') ? model : `MiniMax-${model}`;
          await this.streamOpenAICompatible(
            'https://api.minimaxi.com/v1/chat/completions', minimaxModel, apiKey, allMessages, res,
          );
          break;
        }
        default:
          res.write(`data: ${JSON.stringify({ error: `不支持的服务商: ${provider}` })}\n\n`);
          res.end();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
    }
  }

  // ========== 私有：流式底层实现 ==========

  private async streamOpenAICompatible(
    url: string,
    model: string,
    apiKey: string,
    messages: { role: string; content: string }[],
    res: any,
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
    let hasReasoningContent = false;
    let inThinkBlock = false;

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
              res.write('data: {"type":"done"}\n\n');
              res.flush?.();
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta || {};
              const reasoningContent = delta.reasoning_content || '';
              const content = delta.content || '';

              if (reasoningContent) {
                hasReasoningContent = true;
                res.write(`data: ${JSON.stringify({ type: 'thinking', content: reasoningContent })}\n\n`);
                res.flush?.();
              }
              if (content) {
                if (hasReasoningContent) {
                  res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
                  res.flush?.();
                } else {
                  const result = this.parseThinkTags(content, inThinkBlock);
                  inThinkBlock = result.inThinkBlock;
                  for (const chunk of result.chunks) {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    res.flush?.();
                  }
                }
              }
            } catch {
              continue;
            }
          }
        }
      }
      res.write('data: {"type":"done"}\n\n');
      res.flush?.();
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
    let inThinkBlock = false;

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
              res.write('data: {"type":"done"}\n\n');
              res.flush?.();
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.output?.choices?.[0];
              const reasoningContent = choice?.message?.reasoning_content || '';
              const content = choice?.message?.content || '';

              if (reasoningContent) {
                res.write(`data: ${JSON.stringify({ type: 'thinking', content: reasoningContent })}\n\n`);
                res.flush?.();
              }
              if (content) {
                if (reasoningContent) {
                  res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
                  res.flush?.();
                } else {
                  const result = this.parseThinkTags(content, inThinkBlock);
                  inThinkBlock = result.inThinkBlock;
                  for (const chunk of result.chunks) {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    res.flush?.();
                  }
                }
              }
            } catch {
              continue;
            }
          }
        }
      }
      res.write('data: {"type":"done"}\n\n');
      res.flush?.();
      res.end();
    } finally {
      reader.releaseLock();
    }
  }

  private parseThinkTags(
    content: string,
    currentInThinkBlock: boolean,
  ): { chunks: { type: string; content: string }[]; inThinkBlock: boolean } {
    const chunks: { type: string; content: string }[] = [];
    let inThink = currentInThinkBlock;
    let remaining = content;

    while (remaining.length > 0) {
      if (inThink) {
        const closeIdx = remaining.indexOf('</think');
        if (closeIdx !== -1) {
          const thinkPart = remaining.slice(0, closeIdx);
          if (thinkPart) {
            chunks.push({ type: 'thinking', content: thinkPart });
          }
          const tagEnd = remaining.indexOf('>', closeIdx);
          remaining = tagEnd !== -1 ? remaining.slice(tagEnd + 1) : remaining.slice(closeIdx + '</think'.length);
          inThink = false;
        } else {
          chunks.push({ type: 'thinking', content: remaining });
          remaining = '';
        }
      } else {
        const openIdx = remaining.indexOf('<think');
        if (openIdx !== -1) {
          const answerPart = remaining.slice(0, openIdx);
          if (answerPart) {
            chunks.push({ type: 'content', content: answerPart });
          }
          const tagEnd = remaining.indexOf('>', openIdx);
          remaining = tagEnd !== -1 ? remaining.slice(tagEnd + 1) : remaining.slice(openIdx + '<think'.length);
          inThink = true;
        } else {
          chunks.push({ type: 'content', content: remaining });
          remaining = '';
        }
      }
    }

    return { chunks, inThinkBlock: inThink };
  }
}