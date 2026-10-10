/**
 * useMcpPlugins 单元测试 —— 插件（MCP servers）列表拉取与启停
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getMcpServers: vi.fn(),
  startMcpServer: vi.fn(),
  stopMcpServer: vi.fn(),
}));

vi.mock('../api/mcp', () => ({
  getMcpServers: api.getMcpServers,
  startMcpServer: api.startMcpServer,
  stopMcpServer: api.stopMcpServer,
}));

import { useMcpPlugins } from './useMcpPlugins';
import type { McpServerStatus } from '../api/mcp';

const disconnected: McpServerStatus = {
  name: 'github',
  enabled: true,
  transport: 'stdio',
  connected: false,
  toolCount: 0,
  tools: [],
};

const connected: McpServerStatus = {
  ...disconnected,
  connected: true,
  toolCount: 1,
  tools: [{ name: 'search_repos', description: '搜仓库' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getMcpServers.mockResolvedValue({ servers: [disconnected], total: 1 });
});

describe('useMcpPlugins', () => {
  it('挂载后拉取插件列表并结束 loading', async () => {
    const { result } = renderHook(() => useMcpPlugins());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plugins).toEqual([disconnected]);
    expect(result.current.error).toBeNull();
  });

  it('启用未连接插件：调 start 并刷新列表', async () => {
    api.getMcpServers
      .mockResolvedValueOnce({ servers: [disconnected], total: 1 })
      .mockResolvedValueOnce({ servers: [connected], total: 1 });
    api.startMcpServer.mockResolvedValue({ name: 'github', connected: true, toolCount: 1 });

    const { result } = renderHook(() => useMcpPlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { ok: boolean; message: string } | undefined;
    await act(async () => {
      res = await result.current.togglePlugin(disconnected);
    });

    expect(api.startMcpServer).toHaveBeenCalledWith('github');
    expect(res).toEqual({ ok: true, message: '已启用插件 github' });
    expect(result.current.plugins[0].connected).toBe(true);
  });

  it('停用已连接插件：调 stop 并刷新列表', async () => {
    api.getMcpServers
      .mockResolvedValueOnce({ servers: [connected], total: 1 })
      .mockResolvedValueOnce({ servers: [disconnected], total: 1 });
    api.stopMcpServer.mockResolvedValue({ name: 'github', connected: false });

    const { result } = renderHook(() => useMcpPlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { ok: boolean; message: string } | undefined;
    await act(async () => {
      res = await result.current.togglePlugin(connected);
    });

    expect(api.stopMcpServer).toHaveBeenCalledWith('github');
    expect(res).toEqual({ ok: true, message: '已停用插件 github' });
    expect(result.current.plugins[0].connected).toBe(false);
  });

  it('启停失败返回 ok=false 与错误信息', async () => {
    api.startMcpServer.mockRejectedValue(new Error('连接超时'));

    const { result } = renderHook(() => useMcpPlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { ok: boolean; message: string } | undefined;
    await act(async () => {
      res = await result.current.togglePlugin(disconnected);
    });

    expect(res).toEqual({ ok: false, message: '连接超时' });
    // busy 状态复位
    expect(result.current.busyName).toBeNull();
  });

  it('列表加载失败给出 error', async () => {
    api.getMcpServers.mockRejectedValue(new Error('服务不可用'));
    const { result } = renderHook(() => useMcpPlugins());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('服务不可用');
  });
});
