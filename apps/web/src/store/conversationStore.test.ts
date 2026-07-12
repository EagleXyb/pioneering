/**
 * conversationStore 单元测试
 * 重点验证 create() 的乐观更新 + 并发去重 + 失败回滚
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock sessionApi — 必须在 import store 之前
vi.mock('../api/session', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}));

// Mock localStorage（Zustand persist 需要）
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import { useConversationStore } from './conversationStore';
import * as sessionApi from '../api/session';

const mockCreateSession = sessionApi.createSession as ReturnType<typeof vi.fn>;

describe('conversationStore.create', () => {
  beforeEach(() => {
    // 重置 store 状态
    useConversationStore.setState({
      conversations: [],
      activeId: null,
      loading: false,
      error: null,
      total: 0,
      currentPage: 0,
      sessionModes: {},
      creating: false,
      createPromise: null,
    });
    mockCreateSession.mockReset();
  });

  it('乐观更新：立即插入临时会话并激活', async () => {
    mockCreateSession.mockResolvedValue({
      id: 'real-1',
      title: '新会话',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const promise = useConversationStore.getState().create('chat');

    // 同步检查：临时会话已插入
    const state = useConversationStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].id).toMatch(/^temp_\d+$/);
    expect(state.activeId).toMatch(/^temp_\d+$/);
    expect(state.creating).toBe(true);

    await promise;

    // 异步完成后：临时会话被真实会话替换
    const finalState = useConversationStore.getState();
    expect(finalState.conversations[0].id).toBe('real-1');
    expect(finalState.activeId).toBe('real-1');
    expect(finalState.creating).toBe(false);
  });

  it('并发去重：多次调用复用同一 Promise', async () => {
    mockCreateSession.mockResolvedValue({
      id: 'real-2',
      title: '新会话',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const promise1 = useConversationStore.getState().create('chat');
    const promise2 = useConversationStore.getState().create('chat');

    // async 函数会包装返回值，所以两个 Promise 对象不同，
    // 但应 resolve 到同一个 session ID
    const [id1, id2] = await Promise.all([promise1, promise2]);
    expect(id1).toBe('real-2');
    expect(id2).toBe(id1);

    // createSession 只被调用一次（并发去重生效）
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('失败回滚：移除临时会话并恢复 activeId', async () => {
    // 预设一个已有会话
    useConversationStore.setState({
      conversations: [{
        id: 'existing-1',
        title: '已有会话',
        mode: 'chat',
        preview: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        group: '今天',
      }],
      activeId: 'existing-1',
      total: 1,
    });

    mockCreateSession.mockRejectedValue(new Error('网络错误'));

    await expect(useConversationStore.getState().create('chat')).rejects.toThrow('网络错误');

    const state = useConversationStore.getState();
    // 临时会话已被移除
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].id).toBe('existing-1');
    // activeId 恢复为之前的值
    expect(state.activeId).toBe('existing-1');
    expect(state.creating).toBe(false);
    expect(state.createPromise).toBeNull();
  });

  it('sessionModes 在创建成功后正确映射', async () => {
    mockCreateSession.mockResolvedValue({
      id: 'real-3',
      title: '新会话',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await useConversationStore.getState().create('pro');

    const state = useConversationStore.getState();
    // 临时 ID 的映射应被清除，真实 ID 的映射应存在
    expect(state.sessionModes['real-3']).toBe('pro');
    // 不应有 temp_ 开头的 key
    expect(Object.keys(state.sessionModes).every(k => !k.startsWith('temp_'))).toBe(true);
  });
});
