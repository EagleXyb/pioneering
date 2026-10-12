/**
 * useMcpPlugins —— 输入框插件选择（MCP servers 即插件，pro / task 共用）
 *
 * - 插件列表来自 GET /mcp/servers（含连接状态与工具数），不缓存，实时为准
 * - 挂载时拉取一次；refresh() 手动刷新（打开菜单时调用）
 * - togglePlugin：启用 = 连接 server（POST /mcp/servers/:name/start），
 *   停用 = 断开（POST .../stop），成功后刷新列表；
 *   结果以 { ok, message } 返回，由调用方决定 toast 文案
 * - addPlugin：新增插件（POST /mcp/servers，默认立即连接），成功后刷新列表；
 *   配置已写入但自动连接失败时 ok 仍为 true 且 connectFailed 为 true
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMcpServer,
  getMcpServers,
  startMcpServer,
  stopMcpServer,
  type AddMcpServerInput,
  type McpServerStatus,
} from '../api/mcp';

/** 从未知异常中提取 message，取不到时用 fallback。 */
function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

export interface TogglePluginResult {
  ok: boolean;
  message: string;
}

export interface AddPluginResult extends TogglePluginResult {
  /** 配置已写入但自动连接失败（调用方宜以 warning 而非 success 展示） */
  connectFailed?: boolean;
}

export interface UseMcpPluginsReturn {
  plugins: McpServerStatus[];
  loading: boolean;
  error: string | null;
  /** 正在启停中的插件名（按钮 spinner 用） */
  busyName: string | null;
  refresh: () => Promise<void>;
  togglePlugin: (plugin: McpServerStatus) => Promise<TogglePluginResult>;
  addPlugin: (input: AddMcpServerInput) => Promise<AddPluginResult>;
}

export function useMcpPlugins(): UseMcpPluginsReturn {
  const [plugins, setPlugins] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const resp = await getMcpServers();
      if (!aliveRef.current) return;
      setPlugins(Array.isArray(resp.servers) ? resp.servers : []);
      setError(null);
    } catch (e) {
      if (!aliveRef.current) return;
      setError(errorMessage(e, '插件列表加载失败'));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    refresh().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const togglePlugin = useCallback(
    async (plugin: McpServerStatus): Promise<TogglePluginResult> => {
      setBusyName(plugin.name);
      try {
        if (plugin.connected) {
          await stopMcpServer(plugin.name);
          await refresh();
          return { ok: true, message: `已停用插件 ${plugin.name}` };
        }
        await startMcpServer(plugin.name);
        await refresh();
        return { ok: true, message: `已启用插件 ${plugin.name}` };
      } catch (e) {
        return {
          ok: false,
          message: errorMessage(e, '请稍后重试'),
        };
      } finally {
        setBusyName(null);
      }
    },
    [refresh],
  );

  const addPlugin = useCallback(
    async (input: AddMcpServerInput): Promise<AddPluginResult> => {
      try {
        const resp = await addMcpServer(input);
        await refresh();
        const name = resp.server?.name ?? input.name;
        if (resp.connectError) {
          return {
            ok: true,
            connectFailed: true,
            message: `插件 ${name} 已添加，但连接失败：${resp.connectError}`,
          };
        }
        return {
          ok: true,
          message: resp.server?.connected
            ? `已添加并连接插件 ${name}`
            : `已添加插件 ${name}`,
        };
      } catch (e) {
        return {
          ok: false,
          message: errorMessage(e, '请稍后重试'),
        };
      }
    },
    [refresh],
  );

  return { plugins, loading, error, busyName, refresh, togglePlugin, addPlugin };
}
