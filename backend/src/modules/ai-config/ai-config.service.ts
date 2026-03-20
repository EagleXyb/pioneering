import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAiConfigDto, UpdateAiConfigDto } from './dto/ai-config.dto';
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
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          prompt: '你是一个有用的AI助手。',
        },
      });
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
      data: updateAiConfigDto as Prisma.AIConfigUpdateInput,
    });
  }

  async upsert(createAiConfigDto: CreateAiConfigDto) {
    return this.prisma.aIConfig.upsert({
      where: {
        provider_model: {
          provider: createAiConfigDto.provider,
          model: createAiConfigDto.model,
        },
      },
      update: createAiConfigDto as Prisma.AIConfigUpdateInput,
      create: createAiConfigDto as Prisma.AIConfigCreateInput,
    });
  }

  async remove(id: number) {
    return this.prisma.aIConfig.delete({
      where: { id },
    });
  }
}