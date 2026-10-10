/**
 * PluginPicker —— 输入框底部「插件」选择 chip（pro / task 共用）
 *
 * 插件 = MCP servers：菜单展示每个插件的连接状态与工具数，
 * 点击项即启用（连接）/ 停用（断开），结果经 sonner toast 反馈。
 * 数据与启停逻辑见 useMcpPlugins（打开菜单时刷新一次，实时为准）。
 */
import { useMemo, useState } from 'react';
import { Check, Puzzle, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useMcpPlugins } from '@/hooks/useMcpPlugins';
import type { McpServerStatus } from '@/api/mcp';

interface Props {
  disabled?: boolean;
}

export function PluginPicker({ disabled }: Props) {
  const { plugins, loading, error, busyName, refresh, togglePlugin } =
    useMcpPlugins();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const connectedCount = plugins.filter((p) => p.connected).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.transport.toLowerCase().includes(q),
    );
  }, [plugins, query]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void refresh();
    else setQuery('');
  };

  const handleToggle = async (plugin: McpServerStatus) => {
    const res = await togglePlugin(plugin);
    if (res.ok) toast.success(res.message);
    else toast.error(`操作失败：${res.message}`);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`capability-chip${connectedCount > 0 ? ' capability-chip--on' : ''}`}
          disabled={disabled}
          aria-label={
            connectedCount > 0
              ? `选择插件，已启用 ${connectedCount} 个`
              : '选择插件'
          }
          title="选择插件"
        >
          <Puzzle size={14} />
          插件
          {connectedCount > 0 && (
            <span className="capability-chip__badge">{connectedCount}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="capability-menu"
      >
        <div className="capability-menu__list">
          {loading && (
            <div className="capability-menu__state">
              <Spinner className="h-4 w-4" />
              加载中…
            </div>
          )}

          {!loading && error && (
            <div className="capability-menu__state">
              <span>{error}</span>
              <button
                type="button"
                className="capability-menu__retry"
                onClick={() => void refresh()}
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="capability-menu__state">
              {query.trim()
                ? '未找到匹配的插件'
                : '暂无可用插件。在 modu-agent 配置 mcp.servers 后重启服务即可接入。'}
            </div>
          )}

          {!loading &&
            !error &&
            filtered.map((p) => {
              const busy = busyName === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  className={`capability-item${p.connected ? ' is-selected' : ''}`}
                  onClick={() => void handleToggle(p)}
                  disabled={busy}
                  aria-pressed={p.connected}
                  aria-label={`${p.connected ? '停用' : '启用'}插件 ${p.name}`}
                >
                  <span className="capability-item__icon">
                    <Puzzle size={16} />
                  </span>
                  <span className="capability-item__main">
                    <span className="capability-item__name">
                      {p.name}
                      {p.connected && (
                        <span className="capability-item__tag">已连接</span>
                      )}
                    </span>
                    <span className="capability-item__desc">
                      {p.transport} · {p.toolCount} 个工具
                    </span>
                  </span>
                  {busy ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <Check
                      size={15}
                      className={`capability-item__check${p.connected ? '' : ' is-hidden'}`}
                    />
                  )}
                </button>
              );
            })}
        </div>

        <div className="capability-menu__search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索插件…"
            aria-label="搜索插件"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
