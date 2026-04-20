import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAiConfigDto, UpdateAiConfigDto, TestConnectionResultDto } from './dto/ai-config.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AiConfigService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaultConfig();
  }

  private async ensureDefaultConfig() {
    const config = await this.prisma.aIConfig.findFirst();
    if (!config) {
      await this.prisma.aIConfig.create({
        data: {
          apiKey: '',
          provider: 'deepseek',
          model: 'deepseek-chat',
          prompt: '你是一个有用的AI助手。',
        },
      });
    }
  }

  async testConnection(apiKey: string, provider: string, model: string): Promise<TestConnectionResultDto> {
    const startTime = Date.now();

    try {
      const testPrompt = '请回复"连接测试成功"，仅返回这四个字。';
      const response = await this.callLLMApi(apiKey, provider, model, testPrompt);
      const responseTime = Date.now() - startTime;

      if (response.success) {
        return {
          success: true,
          message: `连接成功！${response.message}`,
          responseTime,
        };
      } else {
        return {
          success: false,
          message: '连接失败',
          error: response.error,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: '连接失败',
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  private async callLLMApi(apiKey: string, provider: string, model: string, prompt: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const messages = [{ role: 'user', content: prompt }];

    switch (provider) {
      case 'deepseek':
        return this.callDeepSeek(model, apiKey, messages);
      case 'glm':
        return this.callGLM(model, apiKey, messages);
      case 'kimi':
        return this.callKimi(model, apiKey, messages);
      case 'qwen':
        return this.callQwen(model, apiKey, messages);
      case 'minimax':
        return this.callMiniMax(model, apiKey, messages);
      default:
        return { success: false, error: `不支持的服务商: ${provider}` };
    }
  }

  private async callDeepSeek(model: string, apiKey: string, messages: any[]): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: `DeepSeek API错误: ${response.status} - ${JSON.stringify(errorData)}` };
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return { success: true, message: data.choices[0].message.content };
      }
      return { success: false, error: 'DeepSeek API响应格式未知' };
    } catch (error) {
      return { success: false, error: `DeepSeek API请求异常: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }

  private async callGLM(model: string, apiKey: string, messages: any[]): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: `GLM API错误: ${response.status} - ${JSON.stringify(errorData)}` };
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return { success: true, message: data.choices[0].message.content };
      } else if (data.text) {
        return { success: true, message: data.text };
      }
      return { success: false, error: 'GLM API响应格式未知' };
    } catch (error) {
      return { success: false, error: `GLM API请求异常: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }

  private async callKimi(model: string, apiKey: string, messages: any[]): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: `Kimi API错误: ${response.status} - ${JSON.stringify(errorData)}` };
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return { success: true, message: data.choices[0].message.content };
      }
      return { success: false, error: 'Kimi API响应格式未知' };
    } catch (error) {
      return { success: false, error: `Kimi API请求异常: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }

  private async callQwen(model: string, apiKey: string, messages: any[]): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: { messages },
          parameters: { temperature: 0.7 }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: `Qwen API错误: ${response.status} - ${JSON.stringify(errorData)}` };
      }

      const data = await response.json();
      if (data.output && data.output.text) {
        return { success: true, message: data.output.text };
      } else if (data.output && data.output.choices && data.output.choices.length > 0) {
        return { success: true, message: data.output.choices[0].message.content };
      }
      return { success: false, error: 'Qwen API响应格式未知' };
    } catch (error) {
      return { success: false, error: `Qwen API请求异常: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }

  private async callMiniMax(model: string, apiKey: string, messages: any[]): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const minimaxModel = model.includes('MiniMax-') ? model : `MiniMax-${model}`;
      const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: minimaxModel,
          messages,
          temperature: 0.7
        })
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        return { success: false, error: `MiniMax API响应格式错误: ${responseText.substring(0, 200)}` };
      }

      if (!response.ok) {
        const errorMsg = data.error?.message || data.message || data.base_resp?.status_msg || `HTTP ${response.status}`;
        return { success: false, error: `MiniMax API错误: ${errorMsg}` };
      }

      if (data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
        let content = data.choices[0].message.content;
        content = content.replace(/<think[\s\S]*?<\/think>/g, '').trim();
        return { success: true, message: content };
      } else if (data.text) {
        let content = data.text;
        content = content.replace(/<think[\s\S]*?<\/think>/g, '').trim();
        return { success: true, message: content };
      } else if (data.output?.text) {
        let content = data.output.text;
        content = content.replace(/<think[\s\S]*?<\/think>/g, '').trim();
        return { success: true, message: content };
      } else if (data.base_resp?.status_code !== 0) {
        return { success: false, error: `MiniMax API错误: ${data.base_resp?.status_msg || '未知错误'}` };
      }
      return { success: false, error: `MiniMax API响应格式未知: ${JSON.stringify(data).substring(0, 200)}` };
    } catch (error) {
      return { success: false, error: `MiniMax API请求异常: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }

  async create(createAiConfigDto: CreateAiConfigDto) {
    return this.prisma.aIConfig.create({
      data: createAiConfigDto as Prisma.AIConfigCreateInput,
    });
  }

  async findAll() {
    return this.prisma.aIConfig.findMany();
  }

  async findOne(id: number) {
    return this.prisma.aIConfig.findUnique({
      where: { id },
    });
  }

  async findLatest() {
    return this.prisma.aIConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findByProviderModel(provider: string, model: string) {
    return this.prisma.aIConfig.findUnique({
      where: {
        provider_model: {
          provider,
          model,
        },
      },
    });
  }

  async update(id: number, updateAiConfigDto: UpdateAiConfigDto) {
    return this.prisma.aIConfig.update({
      where: { id },
      data: {
        ...updateAiConfigDto,
        lastTestTime: updateAiConfigDto.lastTestTime ? new Date(updateAiConfigDto.lastTestTime) : undefined,
      } as Prisma.AIConfigUpdateInput,
    });
  }

  async upsert(createAiConfigDto: CreateAiConfigDto) {
    const latest = await this.findLatest();
    if (latest) {
      return this.prisma.aIConfig.update({
        where: { id: latest.id },
        data: {
          ...createAiConfigDto,
          lastTestTime: createAiConfigDto.lastTestTime ? new Date(createAiConfigDto.lastTestTime) : null,
        } as Prisma.AIConfigUpdateInput,
      });
    }
    return this.prisma.aIConfig.create({
      data: {
        ...createAiConfigDto,
        lastTestTime: createAiConfigDto.lastTestTime ? new Date(createAiConfigDto.lastTestTime) : null,
      } as Prisma.AIConfigCreateInput,
    });
  }

  async saveConfig(createAiConfigDto: CreateAiConfigDto) {
    const existing = await this.findLatest();
    if (existing) {
      return this.prisma.aIConfig.update({
        where: { id: existing.id },
        data: {
          apiKey: createAiConfigDto.apiKey,
          provider: createAiConfigDto.provider,
          model: createAiConfigDto.model,
          prompt: createAiConfigDto.prompt,
          lastTestInput: createAiConfigDto.lastTestInput,
          lastTestResult: createAiConfigDto.lastTestResult,
          lastTestTime: createAiConfigDto.lastTestTime ? new Date(createAiConfigDto.lastTestTime) : null,
        },
      });
    }
    return this.prisma.aIConfig.create({
      data: {
        apiKey: createAiConfigDto.apiKey,
        provider: createAiConfigDto.provider,
        model: createAiConfigDto.model,
        prompt: createAiConfigDto.prompt,
        lastTestInput: createAiConfigDto.lastTestInput,
        lastTestResult: createAiConfigDto.lastTestResult,
        lastTestTime: createAiConfigDto.lastTestTime ? new Date(createAiConfigDto.lastTestTime) : null,
      },
    });
  }

  async remove(id: number) {
    return this.prisma.aIConfig.delete({
      where: { id },
    });
  }

  async streamChat(messages: { role: string; content: string }[], res: any) {
    const config = await this.findLatest();
    if (!config || !config.apiKey || !config.provider || !config.model) {
      res.write(`data: ${JSON.stringify({ error: '配置不完整，请检查API Key、服务商和模型' })}\n\n`);
      res.end();
      return;
    }

    const allMessages: { role: string; content: string }[] = [];
    if (config.prompt && config.prompt.trim()) {
      allMessages.push({ role: 'system', content: config.prompt });
    }
    allMessages.push(...messages);

    const { apiKey, provider, model } = config;

    try {
      switch (provider) {
        case 'deepseek':
          await this.streamOpenAICompatible('https://api.deepseek.com/v1/chat/completions', model, apiKey, allMessages, res);
          break;
        case 'glm':
          await this.streamOpenAICompatible('https://open.bigmodel.cn/api/paas/v4/chat/completions', model, apiKey, allMessages, res);
          break;
        case 'kimi':
          await this.streamOpenAICompatible('https://api.moonshot.cn/v1/chat/completions', model, apiKey, allMessages, res);
          break;
        case 'qwen':
          await this.streamQwen(model, apiKey, allMessages, res);
          break;
        case 'minimax': {
          const minimaxModel = model.includes('MiniMax-') ? model : `MiniMax-${model}`;
          await this.streamOpenAICompatible('https://api.minimaxi.com/v1/chat/completions', minimaxModel, apiKey, allMessages, res);
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
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        stream: true,
      }),
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
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch {
              continue;
            }
          }
        }
      }
      res.write('data: [DONE]\n\n');
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
          parameters: {
            temperature: 0.7,
            incremental_output: true,
          },
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
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content =
                parsed.output?.choices?.[0]?.message?.content ||
                parsed.output?.text ||
                '';
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch {
              continue;
            }
          }
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } finally {
      reader.releaseLock();
    }
  }
}