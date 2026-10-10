/**
 * Schema 单元测试：agentMode 枚举（D4 决策）
 *
 * 对应任务 T0.2：rag_agent 死枚举删除后，非法 agentMode 必须被拒，
 * POST /agent/sessions 经 zod 校验返回 400。
 */
import { describe, it, expect } from 'vitest';
import {
  CreateAgentSessionRequestSchema,
  AgentChatRequestSchema,
} from '../src/schemas/agent.ts';
import {
  ChatCompletionRequestSchema,
  EditMessageRequestSchema,
} from '../src/schemas/chat.ts';

describe('CreateAgentSessionRequestSchema — agentMode', () => {
  it('接受 react_agent 与 plan_execute', () => {
    expect(
      CreateAgentSessionRequestSchema.safeParse({ agentMode: 'react_agent' }).success,
    ).toBe(true);
    expect(
      CreateAgentSessionRequestSchema.safeParse({ agentMode: 'plan_execute' }).success,
    ).toBe(true);
  });

  it('缺省时默认 react_agent', () => {
    const parsed = CreateAgentSessionRequestSchema.parse({});
    expect(parsed.agentMode).toBe('react_agent');
  });

  it('拒绝 rag_agent（D4 已删除的死枚举）', () => {
    const result = CreateAgentSessionRequestSchema.safeParse({ agentMode: 'rag_agent' });
    expect(result.success).toBe(false);
  });

  it('拒绝任意白名单外的 agentMode', () => {
    const result = CreateAgentSessionRequestSchema.safeParse({ agentMode: 'unknown_mode' });
    expect(result.success).toBe(false);
  });
});

describe('AgentChatRequestSchema — agentMode', () => {
  it('拒绝 rag_agent，接受两种有效模式', () => {
    expect(AgentChatRequestSchema.safeParse({ message: 'hi', agentMode: 'rag_agent' }).success).toBe(false);
    expect(AgentChatRequestSchema.parse({ message: 'hi' }).agentMode).toBe('react_agent');
    expect(
      AgentChatRequestSchema.parse({ message: 'hi', agentMode: 'plan_execute' }).agentMode,
    ).toBe('plan_execute');
  });
});

describe('编辑重发字段（方案 B）', () => {
  it('ChatCompletionRequestSchema 接受 messageId 与 truncateAfter，默认均为 undefined', () => {
    const parsed = ChatCompletionRequestSchema.parse({ message: 'hi' });
    expect(parsed.messageId).toBeUndefined();
    // 未显式传入时保持 undefined：路由层据此按"编辑重发默认截断"处理
    expect(parsed.truncateAfter).toBeUndefined();

    const edit = ChatCompletionRequestSchema.parse({
      message: 'hi',
      messageId: 'msg_1',
      truncateAfter: false,
    });
    expect(edit.messageId).toBe('msg_1');
    expect(edit.truncateAfter).toBe(false);
  });

  it('AgentChatRequestSchema 接受 messageId / truncateAfter（pro、task 共用）', () => {
    const parsed = AgentChatRequestSchema.parse({
      message: 'hi',
      messageId: 'msg_1',
      truncateAfter: true,
    });
    expect(parsed.messageId).toBe('msg_1');
    expect(parsed.truncateAfter).toBe(true);
  });

  it('EditMessageRequestSchema 的 truncateAfter 可缺省（保持既有 PUT 语义）', () => {
    expect(EditMessageRequestSchema.parse({ content: 'x' }).truncateAfter).toBeUndefined();
    expect(EditMessageRequestSchema.parse({ content: 'x' }).regenerate).toBe(false);
  });
});
