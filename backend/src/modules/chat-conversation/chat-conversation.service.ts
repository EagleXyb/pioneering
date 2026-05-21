import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateConversationDto, UpdateConversationDto, CreateMessageDto, UpdateMessageDto } from './dto/chat-conversation.dto';

@Injectable()
export class ChatConversationService {
  constructor(private readonly prisma: PrismaService) {}

  // ===== 会话 =====

  async findAllConversations() {
    return this.prisma.chatConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        model: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
  }

  async findConversationById(id: number) {
    return this.prisma.chatConversation.findUnique({ where: { id } });
  }

  async createConversation(dto: CreateConversationDto) {
    return this.prisma.chatConversation.create({
      data: {
        title: dto.title,
        model: dto.model,
      },
    });
  }

  async updateConversation(id: number, dto: UpdateConversationDto) {
    return this.prisma.chatConversation.update({
      where: { id },
      data: dto,
    });
  }

  async deleteConversation(id: number) {
    return this.prisma.chatConversation.delete({ where: { id } });
  }

  // ===== 消息 =====

  async findMessagesByConversation(conversationId: number) {
    return this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createMessage(conversationId: number, dto: CreateMessageDto) {
    const message = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        role: dto.role,
        content: dto.content,
        thinkingContent: dto.thinkingContent,
        answerContent: dto.answerContent,
        status: dto.status,
        error: dto.error,
      },
    });
    // 更新会话的 updatedAt 时间戳
    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return message;
  }

  async updateMessage(id: number, dto: UpdateMessageDto) {
    const message = await this.prisma.chatMessage.update({
      where: { id },
      data: dto,
    });
    // 更新会话的 updatedAt 时间戳
    await this.prisma.chatConversation.update({
      where: { id: message.conversationId },
      data: { updatedAt: new Date() },
    });
    return message;
  }

  async deleteMessage(id: number) {
    return this.prisma.chatMessage.delete({ where: { id } });
  }
}
