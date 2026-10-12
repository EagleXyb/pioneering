/**
 * PluginPicker —— 输入框底部「插件」选择 chip（pro / task 共用）
 *
 * 插件 = MCP servers：菜单顶部为「添加插件 / 管理插件」功能入口
 * （对齐豆包插件菜单），下方展示每个插件的连接状态与工具数，
 * 点击项即启用（连接）/ 停用（断开），结果经 sonner toast 反馈。
 * 数据与启停逻辑见 useMcpPlugins（打开菜单时刷新一次，实时为准）。
 */
import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Cable,
  Check,
  ChevronRight,
  Plus,
  Puzzle,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useMcpPlugins } from '@/hooks/useMcpPlugins';
import { useSettingsDialogStore } from '@/store/settingsDialogStore';
import type { McpServerStatus } from '@/api/mcp';
import { AddPluginDialog } from './AddPluginDialog';

interface Props {
  disabled?: boolean;
}

export function PluginPicker({ disabled }: Props) {
  const { plugins, loading, error, busyName, refresh, togglePlugin, addPlugin } =
    useMcpPlugins();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const openSettings = useSettingsDialogStore((s) => s.openSettings);

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

  /** 「添加插件」：关闭菜单后打开表单对话框 */
  const handleOpenAdd = () => {
    setOpen(false);
    setAddOpen(true);
  };

  /** 「管理插件」：关闭菜单后打开设置对话框的 MCP 分区 */
  const handleOpenManage = () => {
    setOpen(false);
    openSettings('mcp');
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
          {/* chip 图标为 Cable，线宽 1.75 与技能 / 模型胶囊一致；
              菜单列表行内的插件图标仍用 Puzzle */}
          <Cable size={14} strokeWidth={1.75} />
          插件
          {connectedCount > 0 && (
            <span className="capability-chip__badge">{connectedCount}</span>
          )}
          {/* 展开箭头：同技能胶囊（常驻浅灰）；按钮已由 aria-label 表达，故对读屏隐藏 */}
          <ChevronRight
            size={14}
            className="capability-chip__chevron"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      {/* 面板锚点：必须放在 Trigger 之后（Trigger 也注册 Popper Anchor，后注册者胜出） */}
      <PopoverAnchor className="capability-anchor" />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="capability-menu"
      >
        {/* 功能入口（对齐豆包插件菜单）：添加插件 / 管理插件，右侧 ↗ 表示跳转性操作 */}
        <div className="capability-menu__actions">
          <button
            type="button"
            className="capability-action"
            onClick={handleOpenAdd}
            aria-label="添加插件"
          >
            <Plus size={16} className="capability-action__icon" aria-hidden="true" />
            <span className="capability-action__label">添加插件</span>
            <ArrowUpRight
              size={14}
              className="capability-action__arrow"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="capability-action"
            onClick={handleOpenManage}
            aria-label="管理插件"
          >
            <ArrowLeftRight
              size={16}
              className="capability-action__icon"
              aria-hidden="true"
            />
            <span className="capability-action__label">管理插件</span>
            <ArrowUpRight
              size={14}
              className="capability-action__arrow"
              aria-hidden="true"
            />
          </button>
        </div>

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
                : '暂无已接入的插件，点击上方「添加插件」即可接入 MCP Server。'}
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

      {/* 添加插件表单：Popover Root 无 DOM 包装，对话框常驻挂载（open=false 不渲染内容），
          提交由 useMcpPlugins.addPlugin 承接，成功后插件列表自动刷新 */}
      <AddPluginDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={addPlugin}
      />
    </Popover>
  );
}
