// LLM API服务模块

interface LLMResponse {
  content: string;
  error?: string;
}

export class LLMService {
  private static instance: LLMService;

  private constructor() {}

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  async callLLM(config: any, testInput: string): Promise<LLMResponse> {
    try {
      console.log('开始调用LLM服务:', { config, testInput });
      
      const { apiKey, provider, model, prompt } = config;
      const userInput = testInput || '请进行创新能力基础评估';

      if (!apiKey || !provider || !model) {
        return {
          content: '',
          error: '配置不完整，请检查API Key、服务商和模型'
        };
      }

      const response = await this.fetchLLMResponse(provider, model, apiKey, prompt, userInput);
      console.log('LLM服务调用成功:', response);
      return { content: response };
    } catch (error) {
      console.error('LLM API调用错误:', error);
      return {
        content: '',
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  private async fetchLLMResponse(
    provider: string,
    model: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    console.log('开始获取LLM响应:', { provider, model });
    
    let response;

    switch (provider) {
      case 'deepseek':
        response = await this.fetchDeepSeek(model, apiKey, systemPrompt, userPrompt);
        break;
      case 'glm':
        response = await this.fetchGLM(model, apiKey, systemPrompt, userPrompt);
        break;
      case 'kimi':
        response = await this.fetchKimi(model, apiKey, systemPrompt, userPrompt);
        break;
      case 'qwen':
        response = await this.fetchQwen(model, apiKey, systemPrompt, userPrompt);
        break;
      case 'minimax':
        response = await this.fetchMiniMax(model, apiKey, systemPrompt, userPrompt);
        break;
      default:
        throw new Error('不支持的服务商');
    }

    console.log('获取LLM响应成功:', response);
    return response;
  }

  private async fetchDeepSeek(
    model: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const messages: any[] = [];
    
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API请求失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    }
    throw new Error('DeepSeek API响应格式未知');
  }

  private async fetchGLM(
    model: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const messages: any[] = [];
    
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    // 修复GLM API端点地址
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`GLM API请求失败: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('GLM API响应数据:', data);
    
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else if (data.text) {
      return data.text;
    } else if (data.answer) {
      return data.answer;
    } else if (data.response) {
      return data.response;
    } else if (data.result) {
      return data.result;
    }
    throw new Error('GLM API响应格式未知: ' + JSON.stringify(data));
  }

  private async fetchKimi(
    model: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const messages: any[] = [];
    
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`Kimi API请求失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    }
    throw new Error('Kimi API响应格式未知');
  }

  private async fetchQwen(
    model: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const messages: any[] = [];
    
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        input: {
          messages: messages
        },
        parameters: {
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Qwen API请求失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.output && data.output.text) {
      return data.output.text;
    } else if (data.output && data.output.choices && data.output.choices.length > 0) {
      return data.output.choices[0].message.content;
    }
    throw new Error('Qwen API响应格式未知');
  }

  private async fetchMiniMax(
    model: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const messages: any[] = [];
    
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`MiniMax API请求失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    }
    throw new Error('MiniMax API响应格式未知');
  }
}

// 导出单例实例
const llmServiceInstance = LLMService.getInstance();
export default llmServiceInstance;
