import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../common/llm.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ChatService {
  private activeStreams = new Map<string, { controller: AbortController; sessionId: string }>();

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
  ) {}

  // ========== 会话 ==========

  async listSessions(
    userId: string,
    query: { page?: number; pageSize?: number; archived?: boolean },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = { userId };
    if (query.archived !== undefined) {
      where.isArchived = query.archived;
    }

    const [sessions, total] = await Promise.all([
      this.prisma.chatSession.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
        },
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return {
      sessions: sessions.map((s: any) => ({
        id: s.id,
        title: s.title,
        model: s.model,
        modelConfig: s.modelConfig,
        messageCount: s.messageCount,
        lastMessage: s.messages[0]
          ? {
              content: s.messages[0].content.slice(0, 50),
              role: s.messages[0].role,
              createdAt: s.messages[0].createdAt,
            }
          : null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        isArchived: s.isArchived,
      })),
      total,
      page,
      pageSize,
    };
  }

  async createSession(
    userId: string,
    data: { title?: string; model?: string; systemPrompt?: string; initialMessage?: string },
  ) {
    const sessionId = `sess_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    const session = await this.prisma.chatSession.create({
      data: {
        id: sessionId,
        userId,
        title: data.title || '新对话',
        model: data.model || 'gpt-4o-mini',
        systemPrompt: data.systemPrompt,
      },
    });

    return {
      id: session.id,
      title: session.title,
      model: session.model,
      modelConfig: session.modelConfig,
      messageCount: session.messageCount,
      lastMessage: null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      isArchived: session.isArchived,
    };
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
      },
    });

    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new ForbiddenException('无权限访问该会话');

    return {
      id: session.id,
      title: session.title,
      model: session.model,
      modelConfig: session.modelConfig,
      messageCount: session.messageCount,
      lastMessage: session.messages[0]
        ? {
            content: session.messages[0].content.slice(0, 50),
            role: session.messages[0].role,
            createdAt: session.messages[0].createdAt,
          }
        : null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      isArchived: session.isArchived,
    };
  }

  async updateSession(
    userId: string,
    sessionId: string,
    data: { title?: string; model?: string; modelConfig?: any },
  ) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new ForbiddenException('无权限修改该会话');

    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.model !== undefined && { model: data.model }),
        ...(data.modelConfig !== undefined && { modelConfig: data.modelConfig }),
      },
    });

    return {
      id: updated.id,
      title: updated.title,
      model: updated.model,
      modelConfig: updated.modelConfig,
      messageCount: updated.messageCount,
      lastMessage: null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      isArchived: updated.isArchived,
    };
  }

  async deleteSession(userId: string, sessionId: string, archive?: boolean) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new ForbiddenException('无权限删除该会话');

    if (archive !== false) {
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { isArchived: true },
      });
    } else {
      await this.prisma.chatSession.delete({ where: { id: sessionId } });
    }
  }

  // ========== 消息 ==========

  async getMessages(
    userId: string,
    sessionId: string,
    query: { cursor?: string; limit?: number; direction?: 'before' | 'after' },
  ) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new ForbiddenException('无权限查看该会话消息');

    const limit = query.limit || 30;
    const direction = query.direction || 'before';

    const where: any = { sessionId };
    if (query.cursor) {
      const cursorMessage = await this.prisma.chatMessage.findUnique({
        where: { id: query.cursor },
      });
      if (cursorMessage) {
        if (direction === 'before') {
          where.createdAt = { lt: cursorMessage.createdAt };
        } else {
          where.createdAt = { gt: cursorMessage.createdAt };
        }
      }
    }

    const messages = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: direction === 'before' ? 'desc' : 'asc' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    // before 模式需要反转顺序
    const resultMessages = direction === 'before' ? messages.reverse() : messages;

    const nextCursor = resultMessages.length > 0
      ? resultMessages[resultMessages.length - 1].id
      : null;

    return {
      messages: resultMessages.map((m: any) => ({
        id: m.id,
        sessionId: m.sessionId,
        role: m.role,
        content: m.content,
        contentBlocks: m.contentBlocks,
        parentMessageId: m.parentMessageId,
        tokenCount: m.tokenCount,
        feedback: m.feedback,
        metadata: m.metadata,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
    };
  }

  async editMessage(
    userId: string,
    _sessionId: string,
    messageId: string,
    data: { content: string; regenerate?: boolean },
  ) {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('消息不存在');
    if (message.userId !== userId) throw new ForbiddenException('无权限修改该消息');
    if (message.role !== 'user') throw new ForbiddenException('仅允许编辑用户消息');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { content: data.content },
    });

    return {
      id: updated.id,
      sessionId: updated.sessionId,
      role: updated.role,
      content: updated.content,
      contentBlocks: updated.contentBlocks,
      parentMessageId: updated.parentMessageId,
      tokenCount: updated.tokenCount,
      feedback: updated.feedback,
      metadata: updated.metadata,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  // ========== 对话补全 ==========

  async chatCompletion(
    userId: string,
    data: {
      sessionId?: string;
      message: string;
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      parentMessageId?: string;
    },
  ) {
    const { sessionId, userMsgId } = await this.prepareSession(userId, data);

    // 构建消息上下文
    const messages = await this.buildMessageContext(sessionId, data.systemPrompt);
    messages.push({ role: 'user', content: data.message });

    // 调用 LLM API（非流式）
    const { content, model: usedModel } = await this.callLLMApiNonStream(
      messages,
      data.model,
    );

    // 保存 AI 回复
    const assistantMsgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    await this.prisma.chatMessage.create({
      data: {
        id: assistantMsgId,
        sessionId,
        userId,
        role: 'assistant',
        content,
        parentMessageId: userMsgId,
        tokenCount: Math.ceil(content.length / 4),
      },
    });

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        messageCount: { increment: 1 },
        lastMessageId: assistantMsgId,
        updatedAt: new Date(),
      },
    });

    return {
      id: `chatcmpl_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
      sessionId,
      model: usedModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finishReason: 'stop',
        },
      ],
      usage: {
        promptTokens: Math.ceil(data.message.length / 4),
        completionTokens: Math.ceil(content.length / 4),
        totalTokens: Math.ceil((data.message.length + content.length) / 4),
      },
      createdAt: new Date().toISOString(),
    };
  }

  async streamChatCompletion(
    userId: string,
    data: {
      sessionId?: string;
      message: string;
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      parentMessageId?: string;
    },
    res: any,
  ) {
    const { sessionId, userMsgId } = await this.prepareSession(userId, data);

    // 构建消息上下文
    const messages = await this.buildMessageContext(sessionId, data.systemPrompt);
    messages.push({ role: 'user', content: data.message });

    // 获取配置用于确定 model
    const config = await this.llmService.findLatest();
    const provider = config?.provider;
    const model = data.model || config?.model;

    const assistantMsgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const runId = `run_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const collectedContent: string[] = [];
    const collectedThinking: string[] = [];

    // 1) 发送 RUN_STARTED
    res.write(`data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: sessionId, runId })}\n\n`);

    // 2) 包装 res.write 拦截 AG-UI 事件以收集数据
    const originalWrite = res.write.bind(res);
    res.write = (chunk: any) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      const match = str.match(/data: (\{.*\})/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed.type === 'TEXT_MESSAGE_CONTENT' && parsed.delta) {
            collectedContent.push(parsed.delta);
          }
          if (parsed.type === 'THINKING_TEXT_MESSAGE_CONTENT' && parsed.delta) {
            collectedThinking.push(parsed.delta);
          }
        } catch {}
      }
      return originalWrite(chunk);
    };

    // 3) 包装 res.end 先发 RUN_FINISHED 再保存消息
    const originalEnd = res.end.bind(res);
    res.end = async (endChunk?: any) => {
      if (endChunk) originalWrite(endChunk);

      // 发 RUN_FINISHED
      res.write(`data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: sessionId, runId })}\n\n`);

      // 保存完整 AI 回复 + contentBlocks
      const fullContent = collectedContent.join('');
      const fullReasoning = collectedThinking.join('');
      if (fullContent) {
        const contentBlocks: any[] = [];
        const block: any = { id: assistantMsgId, role: 'assistant', content: fullContent };
        if (fullReasoning) {
          block.reasoningContent = fullReasoning;
        }
        contentBlocks.push(block);

        await this.prisma.chatMessage.create({
          data: {
            id: assistantMsgId,
            sessionId,
            userId,
            role: 'assistant',
            content: fullContent,
            contentBlocks,
            parentMessageId: userMsgId,
            tokenCount: Math.ceil(fullContent.length / 4),
          },
        });

        await this.prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            messageCount: { increment: 1 },
            lastMessageId: assistantMsgId,
            updatedAt: new Date(),
          },
        });
      }

      this.activeStreams.delete(assistantMsgId);
      originalEnd();
    };

    this.activeStreams.set(assistantMsgId, { controller: new AbortController(), sessionId });

    // 使用 LlmService 的 streamChat 进行流式输出
    await this.llmService.streamChat(messages, res, assistantMsgId, provider, model);
  }

  // ========== 辅助方法 ==========

  /**
   * 准备会话：确认无 sessionId 则自动创建，保存用户消息
   */
  private async prepareSession(
    userId: string,
    data: {
      sessionId?: string;
      message: string;
      model?: string;
      systemPrompt?: string;
      parentMessageId?: string;
    },
  ) {
    let sessionId = data.sessionId;
    if (sessionId) {
      const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException('会话不存在');
      if (session.userId !== userId) throw new ForbiddenException('无权限访问该会话');
    } else {
      sessionId = `sess_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
      await this.prisma.chatSession.create({
        data: {
          id: sessionId,
          userId,
          title: data.message.slice(0, 50) || '新对话',
          model: data.model || 'deepseek-v4-flash',
          systemPrompt: data.systemPrompt,
        },
      });
    }

    const userMsgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    await this.prisma.chatMessage.create({
      data: {
        id: userMsgId,
        sessionId,
        userId,
        role: 'user',
        content: data.message,
        parentMessageId: data.parentMessageId,
      },
    });

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { messageCount: { increment: 1 }, updatedAt: new Date() },
    });

    return { sessionId, userMsgId };
  }

  /**
   * 构建消息上下文：system prompt + 最近历史消息
   */
  private async buildMessageContext(
    sessionId: string,
    overrideSystemPrompt?: string,
  ): Promise<{ role: string; content: string }[]> {
    const messages: { role: string; content: string }[] = [];

    // 获取 session 的 systemPrompt，或被覆盖的
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    const config = await this.llmService.findLatest();
    const systemPrompt = overrideSystemPrompt || session?.systemPrompt;

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    } else if (config?.prompt) {
      messages.push({ role: 'system', content: config.prompt });
    }

    // 加载最近历史消息（最多 20 条，做上下文窗口）
    const historyMessages = await this.prisma.chatMessage.findMany({
      where: { sessionId, role: { not: 'system' } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { role: true, content: true },
    });

    messages.push(
      ...historyMessages.reverse().map((m: any) => ({ role: m.role, content: m.content })),
    );

    return messages;
  }

  /**
   * 非流式调用 LLM API，返回完整回复内容
   */
  private async callLLMApiNonStream(
    messages: { role: string; content: string }[],
    overrideModel?: string,
  ): Promise<{ content: string; model: string }> {
    return this.llmService.callNonStream(messages, overrideModel);
  }

  async stopGeneration(_userId: string, sessionId: string, messageId?: string) {
    // 有 messageId 时精确查找
    if (messageId) {
      const entry = this.activeStreams.get(messageId);
      if (entry) {
        entry.controller.abort();
        this.activeStreams.delete(messageId);
        return;
      }
    }

    // 降级：无 messageId 时，遍历查找该 session 的活跃流
    for (const [id, entry] of this.activeStreams) {
      if (entry.sessionId === sessionId) {
        entry.controller.abort();
        this.activeStreams.delete(id);
        return;
      }
    }
  }

  // ========== 反馈 ==========

  async setFeedback(userId: string, messageId: string, feedback: 'like' | 'dislike' | 'none') {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('消息不存在');
    if (message.userId !== userId) throw new ForbiddenException('无权限操作该消息');

    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { feedback },
    });
  }

  // ========== 重新生成 ==========

  async regenerate(
    userId: string,
    parentMessageId: string,
    data: { model?: string; temperature?: number; maxTokens?: number },
  ) {
    const parentMsg = await this.prisma.chatMessage.findUnique({
      where: { id: parentMessageId },
    });
    if (!parentMsg) throw new NotFoundException('父消息不存在');
    if (parentMsg.userId !== userId) throw new ForbiddenException('无权限操作');

    // 构建消息上下文（不包含这条父消息之后的 assistant 回复）
    const messages = await this.buildMessageContext(parentMsg.sessionId);
    // 只取到这条父消息为止
    const parentIdx = messages.findIndex((m) => m.role === 'user' && m.content === parentMsg.content);
    const contextMessages = parentIdx >= 0 ? messages.slice(0, parentIdx + 1) : messages;

    // 调用 LLM API 非流式重新生成
    const { content } = await this.callLLMApiNonStream(contextMessages, data.model);

    const assistantMsgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const newMsg = await this.prisma.chatMessage.create({
      data: {
        id: assistantMsgId,
        sessionId: parentMsg.sessionId,
        userId,
        role: 'assistant',
        content,
        parentMessageId,
        tokenCount: Math.ceil(content.length / 4),
      },
    });

    await this.prisma.chatSession.update({
      where: { id: parentMsg.sessionId },
      data: {
        messageCount: { increment: 1 },
        lastMessageId: assistantMsgId,
        updatedAt: new Date(),
      },
    });

    return {
      id: newMsg.id,
      sessionId: newMsg.sessionId,
      role: newMsg.role,
      content: newMsg.content,
      contentBlocks: newMsg.contentBlocks,
      parentMessageId: newMsg.parentMessageId,
      tokenCount: newMsg.tokenCount,
      feedback: newMsg.feedback,
      metadata: newMsg.metadata,
      createdAt: newMsg.createdAt,
      updatedAt: newMsg.updatedAt,
    };
  }
}