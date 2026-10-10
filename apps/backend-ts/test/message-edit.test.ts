/**
 * 用户消息「编辑重发」后端测试（方案 B）
 *
 * 覆盖两层：
 *   A. core/message-edit.applyUserMessageEdit —— 校验、更新、截断、计数重算
 *   B. 路由层 —— POST /chat/completions 的编辑重发分支与既有分支不回归；
 *      PUT /chat/sessions/:id/messages/:messageId 的 truncateAfter 扩展
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const { chatCompletionMock } = vi.hoisted(() => ({ chatCompletionMock: vi.fn() }))

vi.mock('../src/plugins/auth.js', () => ({
  authGuard: async (req: { user?: unknown }) => {
    req.user = { id: 'user-1' }
  },
}))

vi.mock('../src/core/llm.js', () => ({
  llmService: {
    chatCompletion: chatCompletionMock,
    streamAgui: vi.fn(),
  },
}))

import { applyUserMessageEdit, messagesAfterWhere } from '../src/core/message-edit.js'
import { chatRoutes } from '../src/routes/chat.js'

// ===== prisma 桩 =====

function mockPrisma() {
  const chatMessage = {
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      ...args.data,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'msg_u2',
      sessionId: 'sess-1',
      role: 'user',
      contentBlocks: null,
      tokenCount: null,
      feedback: null,
      extraMetadata: null,
      parentMessageId: null,
      ...args.data,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })),
    deleteMany: vi.fn(async () => ({ count: 2 })),
    delete: vi.fn(async () => ({})),
    count: vi.fn(async () => 3),
  }
  const chatSession = {
    findUnique: vi.fn(async () => ({
      id: 'sess-1',
      userId: 'user-1',
      systemPrompt: null,
    })),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => args.data),
    update: vi.fn(async () => ({})),
  }
  const prisma = {
    chatMessage,
    chatSession,
    userQuota: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    tokenUsage: { create: vi.fn(async () => ({})) },
  }
  return { prisma, chatMessage, chatSession }
}

const TARGET = {
  id: 'msg_u2',
  sessionId: 'sess-1',
  userId: 'user-1',
  role: 'user',
  content: '旧正文',
  createdAt: new Date('2026-01-01T00:00:10Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ===== A. core/message-edit =====

describe('messagesAfterWhere', () => {
  it('使用 (createdAt, id) 复合条件表达"晚于锚点"，与消息分页排序同口径', () => {
    const anchor = { createdAt: new Date('2026-01-01T00:00:10Z'), id: 'msg_u2' }
    expect(messagesAfterWhere('sess-1', anchor)).toEqual({
      sessionId: 'sess-1',
      OR: [
        { createdAt: { gt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { gt: 'msg_u2' } },
      ],
    })
  })
})

describe('applyUserMessageEdit', () => {
  it('更新正文并截断其后消息，同时重算 messageCount 与 lastMessageId', async () => {
    const { prisma, chatMessage, chatSession } = mockPrisma()
    chatMessage.findFirst
      .mockResolvedValueOnce(TARGET) // 目标消息
      .mockResolvedValueOnce({ id: 'msg_u2' }) // 截断后最后一条
    chatMessage.count.mockResolvedValue(3)

    const result = await applyUserMessageEdit(prisma as never, {
      sessionId: 'sess-1',
      userId: 'user-1',
      messageId: 'msg_u2',
      content: '新正文',
      truncateAfter: true,
    })

    expect(chatMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg_u2' },
      data: { content: '新正文' },
    })
    expect(chatMessage.deleteMany).toHaveBeenCalledWith({
      where: messagesAfterWhere('sess-1', { createdAt: TARGET.createdAt, id: 'msg_u2' }),
    })
    expect(chatMessage.count).toHaveBeenCalledWith({ where: { sessionId: 'sess-1' } })
    expect(chatSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { messageCount: 3, lastMessageId: 'msg_u2' },
    })
    expect(result).toMatchObject({ id: 'msg_u2', truncatedCount: 2 })
  })

  it('truncateAfter=false 时不删除任何消息、不重算计数（保持既有 PUT 语义）', async () => {
    const { prisma, chatMessage, chatSession } = mockPrisma()
    chatMessage.findFirst.mockResolvedValueOnce(TARGET)

    await applyUserMessageEdit(prisma as never, {
      sessionId: 'sess-1',
      userId: 'user-1',
      messageId: 'msg_u2',
      content: '新正文',
      truncateAfter: false,
    })

    expect(chatMessage.deleteMany).not.toHaveBeenCalled()
    expect(chatSession.update).not.toHaveBeenCalled()
  })

  it('消息不存在 → 404', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst.mockResolvedValue(null)

    await expect(
      applyUserMessageEdit(prisma as never, {
        sessionId: 'sess-1',
        userId: 'user-1',
        messageId: 'msg_x',
        content: 'x',
        truncateAfter: true,
      }),
    ).rejects.toMatchObject({ statusCode: 404, message: '消息不存在' })
  })

  it('非用户消息 → 403', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst.mockResolvedValue({ ...TARGET, role: 'assistant' })

    await expect(
      applyUserMessageEdit(prisma as never, {
        sessionId: 'sess-1',
        userId: 'user-1',
        messageId: 'msg_a1',
        content: 'x',
        truncateAfter: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403, message: '仅允许编辑用户消息' })
  })

  it('归属校验：查询条件同时约束 sessionId 与 userId', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst.mockResolvedValue(TARGET)

    await applyUserMessageEdit(prisma as never, {
      sessionId: 'sess-1',
      userId: 'user-1',
      messageId: 'msg_u2',
      content: 'x',
      truncateAfter: false,
    })

    expect(chatMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'msg_u2', sessionId: 'sess-1', userId: 'user-1' },
    })
  })
})

// ===== B. 路由层 =====

async function buildServer(prisma: unknown): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorate('prisma', prisma as never)
  // 必须在注册路由前设置：错误处理器按作用域继承，注册后再设置子作用域不会生效
  app.setErrorHandler((err, _req, reply) => {
    reply.code(err.statusCode ?? 500).send({ message: err.message })
  })
  await app.register(chatRoutes)
  return app
}

describe('POST /chat/completions — 编辑重发', () => {
  it('携带 messageId 时不新建用户消息，改为更新 + 截断，并写入 assistant', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst
      .mockResolvedValueOnce(TARGET) // 目标用户消息
      .mockResolvedValueOnce({ id: 'msg_u2' }) // 截断后最后一条
    chatMessage.count.mockResolvedValue(2)
    chatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '新的回复' } }],
      usage: { completion_tokens: 8 },
    })

    const app = await buildServer(prisma)
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        sessionId: 'sess-1',
        message: '新正文',
        stream: false,
        messageId: 'msg_u2',
      },
    })

    expect(res.statusCode).toBe(200)
    // 非流式分支沿用既有 ChatCompletion 响应结构
    expect(res.json()).toMatchObject({
      sessionId: 'sess-1',
      choices: [{ message: { content: '新的回复' } }],
    })

    // 只创建了一条消息：assistant（用户消息是既有的，不应再 create）
    expect(chatMessage.create).toHaveBeenCalledTimes(1)
    expect(chatMessage.create.mock.calls[0][0].data).toMatchObject({
      role: 'assistant',
      parentMessageId: 'msg_u2',
    })
    // 截断发生
    expect(chatMessage.deleteMany).toHaveBeenCalledTimes(1)
    // 用户消息正文被更新（不是新建）
    expect(chatMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg_u2' },
      data: { content: '新正文' },
    })
  })

  it('显式 truncateAfter=false 时不截断', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst.mockResolvedValueOnce(TARGET)
    chatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    })

    const app = await buildServer(prisma)
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        sessionId: 'sess-1',
        message: 'x',
        stream: false,
        messageId: 'msg_u2',
        truncateAfter: false,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(chatMessage.deleteMany).not.toHaveBeenCalled()
  })

  it('携带 messageId 但缺少 sessionId → 400', async () => {
    const { prisma } = mockPrisma()
    const app = await buildServer(prisma)

    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: { message: 'x', stream: false, messageId: 'msg_u2' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('回归：未携带 messageId 时保持"新建用户消息 + messageCount 自增"的既有行为', async () => {
    const { prisma, chatMessage, chatSession } = mockPrisma()
    chatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '回复' } }],
    })

    const app = await buildServer(prisma)
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: { sessionId: 'sess-1', message: '普通提问', stream: false },
    })

    expect(res.statusCode).toBe(200)
    expect(chatMessage.create).toHaveBeenCalledTimes(2) // user + assistant
    expect(chatMessage.create.mock.calls[0][0].data).toMatchObject({
      role: 'user',
      content: '普通提问',
    })
    expect(chatMessage.deleteMany).not.toHaveBeenCalled()
    expect(chatSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { messageCount: { increment: 1 } },
    })
  })

  it('回归：编辑重发时 LLM 失败不会删除既有的用户消息', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst
      .mockResolvedValueOnce(TARGET)
      .mockResolvedValueOnce({ id: 'msg_u2' })
    chatCompletionMock.mockRejectedValue(new Error('upstream down'))

    const app = await buildServer(prisma)
    const res = await app.inject({
      method: 'POST',
      url: '/chat/completions',
      payload: {
        sessionId: 'sess-1',
        message: '新正文',
        stream: false,
        messageId: 'msg_u2',
      },
    })

    expect(res.statusCode).toBe(502)
    // 编辑重发失败时不得回滚删除既有的用户消息
    expect(chatMessage.delete).not.toHaveBeenCalled()
  })
})

describe('PUT /chat/sessions/:sessionId/messages/:messageId', () => {
  it('truncateAfter=true 时截断其后消息并返回更新后的消息', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst
      .mockResolvedValueOnce(TARGET) // 目标
      .mockResolvedValueOnce({ id: 'msg_u2' }) // 截断后最后一条
      .mockResolvedValueOnce(TARGET) // 响应回读
    chatMessage.count.mockResolvedValue(1)

    const app = await buildServer(prisma)
    const res = await app.inject({
      method: 'PUT',
      url: '/chat/sessions/sess-1/messages/msg_u2',
      payload: { content: '改后', truncateAfter: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'msg_u2', role: 'user' })
    expect(chatMessage.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('回归：不带 truncateAfter 时只改正文（既有行为）', async () => {
    const { prisma, chatMessage, chatSession } = mockPrisma()
    chatMessage.findFirst
      .mockResolvedValueOnce(TARGET)
      .mockResolvedValueOnce(TARGET)

    const app = await buildServer(prisma)
    const res = await app.inject({
      method: 'PUT',
      url: '/chat/sessions/sess-1/messages/msg_u2',
      payload: { content: '改后' },
    })

    expect(res.statusCode).toBe(200)
    expect(chatMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg_u2' },
      data: { content: '改后' },
    })
    expect(chatMessage.deleteMany).not.toHaveBeenCalled()
    expect(chatSession.update).not.toHaveBeenCalled()
  })

  it('消息不存在 → 404', async () => {
    const { prisma, chatMessage } = mockPrisma()
    chatMessage.findFirst.mockResolvedValue(null)

    const app = await buildServer(prisma)
    const res = await app.inject({
      method: 'PUT',
      url: '/chat/sessions/sess-1/messages/msg_missing',
      payload: { content: 'x' },
    })

    expect(res.statusCode).toBe(404)
  })
})
