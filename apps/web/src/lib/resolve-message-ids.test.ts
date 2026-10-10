/**
 * resolveLocalMessageIds 单元测试
 *
 * 关键安全性质：宁可解析失败（返回空映射），也不能把 A 消息的真实 id
 * 错配到 B 消息上——错配会静默改错后端数据。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getMessages = vi.fn();

vi.mock('../api/message', () => ({
  getMessages: (...args: unknown[]) => getMessages(...args),
}));

import { isLocalMessageId, resolveLocalMessageIds } from './resolve-message-ids';

type Msg = {
  id: string;
  role: string;
  content?: Array<{ type?: string; data?: unknown }>;
};

const user = (id: string, text: string): Msg => ({
  id,
  role: 'user',
  content: [{ type: 'text', data: text }],
});
const assistant = (id: string, text: string): Msg => ({
  id,
  role: 'assistant',
  content: [{ type: 'markdown', data: text }],
});

/** 后端真实历史（raw Message 形态） */
function remoteResp(rows: Array<{ id: string; role: string; content: string }>) {
  return {
    messages: rows.map((r) => ({
      id: r.id,
      sessionId: 's1',
      role: r.role,
      content: r.content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    nextCursor: null,
    hasMore: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isLocalMessageId', () => {
  it('识别本地临时 id（u_ / a_ + 时间戳）', () => {
    expect(isLocalMessageId('u_1760000000000')).toBe(true);
    expect(isLocalMessageId('a_1760000000000')).toBe(true);
  });

  it('不把后端 id 与占位 id 误判为本地 id', () => {
    expect(isLocalMessageId('msg_abc123')).toBe(false);
    expect(isLocalMessageId('assistant-hitl-s1-1760000000000')).toBe(false);
    expect(isLocalMessageId('u_abc')).toBe(false);
  });
});

describe('resolveLocalMessageIds', () => {
  it('全部为后端 id 时不发请求，直接返回空映射', async () => {
    const map = await resolveLocalMessageIds('s1', [user('msg_1', 'hi')]);
    expect(map.size).toBe(0);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('temp 会话不请求（后端尚无该会话）', async () => {
    const map = await resolveLocalMessageIds('temp_1', [user('u_1', 'hi')]);
    expect(map.size).toBe(0);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('尾部对齐：把 u_* 解析为对应的后端真实 id', async () => {
    getMessages.mockResolvedValue(
      remoteResp([
        { id: 'msg_u1', role: 'user', content: '第一问' },
        { id: 'msg_a1', role: 'assistant', content: '第一答' },
        { id: 'msg_u2', role: 'user', content: '第二问' },
        { id: 'msg_a2', role: 'assistant', content: '第二答' },
      ]),
    );
    const local: Msg[] = [
      user('msg_u1', '第一问'),
      assistant('msg_a1', '第一答'),
      user('u_200', '第二问'),
      assistant('a_200', '第二答'),
    ];

    const map = await resolveLocalMessageIds('s1', local);

    expect(map.get('u_200')).toBe('msg_u2');
    expect(map.get('a_200')).toBe('msg_a2');
  });

  it('本地存在未持久化的 HITL 占位时不会整体错位（不错配）', async () => {
    // 后端只到 u3（暂停的 assistant 未落库）
    getMessages.mockResolvedValue(
      remoteResp([
        { id: 'msg_u1', role: 'user', content: '问一' },
        { id: 'msg_a1', role: 'assistant', content: '答一' },
        { id: 'msg_u3', role: 'user', content: '问二' },
      ]),
    );
    const local: Msg[] = [
      user('msg_u1', '问一'),
      assistant('msg_a1', '答一'),
      user('u_300', '问二'),
      { id: 'assistant-hitl-s1-1', role: 'assistant', content: [{ type: 'text', data: '' }] },
    ];

    const map = await resolveLocalMessageIds('s1', local);

    expect(map.get('u_300')).toBe('msg_u3');
    // 占位消息不是本地 id，不应被解析
    expect(map.has('assistant-hitl-s1-1')).toBe(false);
  });

  it('文本不一致（本地已改动且未落库）时该条不解析，绝不张冠李戴', async () => {
    getMessages.mockResolvedValue(
      remoteResp([
        { id: 'msg_u1', role: 'user', content: '原始内容' },
        { id: 'msg_a1', role: 'assistant', content: '答' },
      ]),
    );
    const local: Msg[] = [user('u_400', '被改过的内容'), assistant('a_400', '答')];

    const map = await resolveLocalMessageIds('s1', local);

    // 正文与后端不一致的 user 消息必须不解析（否则会把 msg_u1 错配给它）
    expect(map.has('u_400')).toBe(false);
    // 同文本的 assistant 消息仍可正确解析
    expect(map.get('a_400')).toBe('msg_a1');
  });

  it('重复文本按时间序单调配对（不重复使用同一条远端消息）', async () => {
    getMessages.mockResolvedValue(
      remoteResp([
        { id: 'msg_u1', role: 'user', content: '继续' },
        { id: 'msg_a1', role: 'assistant', content: '答一' },
        { id: 'msg_u2', role: 'user', content: '继续' },
        { id: 'msg_a2', role: 'assistant', content: '答二' },
      ]),
    );
    const local: Msg[] = [
      user('u_500', '继续'),
      assistant('a_500', '答一'),
      user('u_600', '继续'),
      assistant('a_600', '答二'),
    ];

    const map = await resolveLocalMessageIds('s1', local);

    expect(map.get('u_500')).toBe('msg_u1');
    expect(map.get('u_600')).toBe('msg_u2');
  });

  it('历史接口失败时不抛错，返回空映射', async () => {
    getMessages.mockRejectedValue(new Error('network'));
    const map = await resolveLocalMessageIds('s1', [user('u_700', 'hi')]);
    expect(map.size).toBe(0);
  });

  it('过滤 system / tool 消息，避免污染对齐序列', async () => {
    getMessages.mockResolvedValue({
      messages: [
        { id: 'msg_sys', sessionId: 's1', role: 'system', content: '系统提示' },
        { id: 'msg_u1', sessionId: 's1', role: 'user', content: 'hi' },
        { id: 'msg_tool', sessionId: 's1', role: 'tool', content: 'tool out' },
      ],
      nextCursor: null,
      hasMore: false,
    });
    const map = await resolveLocalMessageIds('s1', [user('u_800', 'hi')]);
    expect(map.get('u_800')).toBe('msg_u1');
  });
});
