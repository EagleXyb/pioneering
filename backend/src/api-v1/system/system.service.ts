import { Injectable } from '@nestjs/common';

@Injectable()
export class SystemService {
  getModels() {
    return [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        description: 'DeepSeek 快速模型',
        maxTokens: 128000,
        pricing: { inputPrice: 0.14, outputPrice: 0.28 },
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        description: 'DeepSeek 专业模型',
        maxTokens: 128000,
        pricing: { inputPrice: 0.28, outputPrice: 0.56 },
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: '轻量级多模态模型，适用于日常对话和代码生成',
        maxTokens: 128000,
        pricing: { inputPrice: 0.15, outputPrice: 0.6 },
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: '高性能多模态模型，适用于复杂任务',
        maxTokens: 128000,
        pricing: { inputPrice: 2.5, outputPrice: 10 },
      },
    ];
  }

  getConfig() {
    return {
      maxMessageLength: 10000,
      maxSessionCount: 100,
      supportedModels: this.getModels(),
      fileUpload: {
        maxSize: 10485760, // 10MB
        allowedTypes: [
          'image/png',
          'image/jpeg',
          'image/gif',
          'image/webp',
          'application/pdf',
          'text/plain',
        ],
      },
    };
  }

  getHealth() {
    return {
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}