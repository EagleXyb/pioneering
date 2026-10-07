/**
 * 设置面板中的 MCP servers 区块（T5.2）
 *
 * 挂载时拉 GET /mcp/servers + GET /mcp/policy：
 *   - 展示连接状态、工具数量；可展开查看每个 server 的工具清单
 *   - 单个 server 的启动 / 停止
 *   - 按工具开启/关闭人工审批（写入 tools.human_in_loop.sensitive_tools）
 * 错误态给出重试与 sonner 反馈。
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  getMcpServers,
  getMcpPolicy,
  startMcpServer,
  stopMcpServer,
  updateMcpPolicy,
  type McpServerStatus,
  type McpPolicy,
} from '@/api/mcp';

/** MCP 工具在审批名单中的全限定名（与 MCPToolAdapter.name() 一致）。 */
function qualifiedToolName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}

/** 从未知异常中提取 message，取不到时用 fallback。 */
function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return fallback;
}

export function McpSection() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [policy, setPolicy] = useState<McpPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [serverResp, policyResp] = await Promise.all([
        getMcpServers(),
        getMcpPolicy().catch(() => ({
          hitlEnabled: false,
          sensitiveTools: [] as string[],
        })),
      ]);
      setServers(serverResp.servers);
      setPolicy(policyResp);
    } catch (e) {
      setError(errorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleToggleServer = async (server: McpServerStatus) => {
    const isConnected = server.connected;
    setBusyName(server.name);
    try {
      if (isConnected) {
        await stopMcpServer(server.name);
        toast.success(`已停止 ${server.name}`);
      } else {
        await startMcpServer(server.name);
        toast.success(`已连接 ${server.name}`);
      }
      const r = await getMcpServers();
      setServers(r.servers);
      // 新连接通常带工具，自动展开
      if (!isConnected && r.servers.find((s) => s.name === server.name)?.tools.length) {
        setExpanded((prev) => new Set(prev).add(server.name));
      }
    } catch (e) {
      toast.error(
        `${isConnected ? '停止' : '连接'}失败：${errorMessage(e, '请稍后重试')}`,
      );
    } finally {
      setBusyName(null);
    }
  };

  const handleToggleToolApproval = async (
    serverName: string,
    toolName: string,
    requireApproval: boolean,
  ) => {
    if (!policy) return;
    const qualified = qualifiedToolName(serverName, toolName);
    const nextSet = new Set(policy.sensitiveTools);
    if (requireApproval) nextSet.add(qualified);
    else nextSet.delete(qualified);

    setBusyTool(qualified);
    try {
      const updated = await updateMcpPolicy({
        sensitiveTools: [...nextSet],
      });
      setPolicy(updated);
      toast.success(requireApproval ? '已开启该工具的人工审批' : '已关闭该工具的人工审批');
    } catch (e) {
      toast.error(`审批策略更新失败：${errorMessage(e, '请稍后重试')}`);
    } finally {
      setBusyTool(null);
    }
  };

  if (loading) {
    return <div className="settings-hint">MCP servers 加载中…</div>;
  }

  if (error) {
    return (
      <div className="settings-hint">
        MCP 状态加载失败：{error}
        <button type="button" className="settings-inline-action" onClick={load}>
          重试
        </button>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="settings-hint">
        暂无配置的 MCP server。在 modu-agent 配置
        <code>mcp.servers</code>后重启服务即可接入。
      </div>
    );
  }

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">MCP Servers</h3>
      <div className="settings-group-card">
        {servers.map((s) => {
          const isExpanded = expanded.has(s.name);
          const hasTools = s.tools.length > 0;
          return (
            <div key={s.name} className="mcp-server-block">
              <div className="setting-row setting-row--card mcp-server-row">
                <button
                  type="button"
                  className="mcp-expand-btn"
                  onClick={() => hasTools && toggleExpand(s.name)}
                  aria-label={hasTools ? (isExpanded ? '收起工具清单' : '展开工具清单') : '无工具'}
                  aria-expanded={isExpanded}
                  disabled={!hasTools}
                >
                  {hasTools ? (
                    isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )
                  ) : (
                    <ChevronRight size={14} className="mcp-expand-btn--muted" />
                  )}
                </button>
                <div className="setting-row-text">
                  <div className="setting-row-title">{s.name}</div>
                  <div className="setting-row-desc">
                    {s.transport} · {s.enabled ? '已启用' : '已禁用'} ·{' '}
                    {s.toolCount} 个工具
                  </div>
                </div>
                <span
                  className={`mcp-status-dot${s.connected ? ' mcp-status-dot--on' : ''}`}
                >
                  {s.connected ? '已连接' : '未连接'}
                </span>
                <button
                  type="button"
                  className="mcp-power-btn"
                  onClick={() => handleToggleServer(s)}
                  disabled={busyName === s.name || !s.enabled}
                  aria-label={s.connected ? `停止 ${s.name}` : `启动 ${s.name}`}
                >
                  {busyName === s.name ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : s.connected ? (
                    <Square size={13} />
                  ) : (
                    <Play size={13} />
                  )}
                </button>
              </div>

              {isExpanded && hasTools && (
                <ul className="mcp-tool-list">
                  {s.tools.map((t) => {
                    const qualified = qualifiedToolName(s.name, t.name);
                    const requiresApproval =
                      policy?.sensitiveTools.includes(qualified) ?? false;
                    return (
                      <li key={t.name} className="mcp-tool-item">
                        <div className="setting-row-text">
                          <div className="mcp-tool-name">{t.name}</div>
                          {t.description && (
                            <div className="mcp-tool-desc" title={t.description}>
                              {t.description}
                            </div>
                          )}
                        </div>
                        <Switch
                          checked={requiresApproval}
                          disabled={busyTool === qualified}
                          onCheckedChange={(v) =>
                            handleToggleToolApproval(s.name, t.name, v)
                          }
                          aria-label={`${t.name} 人工审批开关`}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
