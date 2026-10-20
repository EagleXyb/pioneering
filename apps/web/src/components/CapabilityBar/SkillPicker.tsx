/**
 * SkillPicker —— 输入框底部「技能」选择 chip（pro / task 共用）
 *
 * 参考豆包输入框底部能力入口：透明功能胶囊 + 上弹菜单，
 * 菜单内为技能列表（图标 + 名称 + 描述，多选打勾），底部固定搜索框。
 * 列表数据与勾选状态见 useSkillOptions（列表 GET /skills，按模式持久化）。
 */
import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Pickaxe,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useSkillOptions } from '@/hooks/useSkillOptions';
import { useSettingsDialogStore } from '@/store/settingsDialogStore';
import type { AppMode } from '@/types';

interface Props {
  mode: AppMode;
  disabled?: boolean;
}

export function SkillPicker({ mode, disabled }: Props) {
  const {
    skills,
    enabled,
    loading,
    error,
    selected,
    isSelected,
    toggleSkill,
    reload,
  } = useSkillOptions(mode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openSettings = useSettingsDialogStore((s) => s.openSettings);

  /** 「管理技能」：跳设置 → 技能分区（启用 / 停用 / 重新扫描） */
  const handleOpenManage = () => {
    setOpen(false);
    openSettings('skills');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [skills, query]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`capability-chip${selected.length > 0 ? ' capability-chip--on' : ''}`}
          disabled={disabled}
          aria-label={
            selected.length > 0
              ? `选择技能，已选 ${selected.length} 个`
              : '选择技能'
          }
          title="选择技能"
        >
          {/* chip 图标为 Pickaxe，线宽 1.75 与同排其它胶囊一致；
              菜单列表行内的技能图标仍用 Sparkles */}
          <Pickaxe size={14} strokeWidth={1.75} />
          技能
          {selected.length > 0 && (
            <span className="capability-chip__badge">{selected.length}</span>
          )}
          {/* 展开箭头：常驻浅灰，语义为「打开面板」；按钮已由 aria-label 表达，故对读屏隐藏 */}
          <ChevronRight
            size={14}
            className="capability-chip__chevron"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      {/* 面板锚点：盒子 = 输入框卡片，令面板与输入框等宽并贴其上沿。
          必须放在 Trigger 之后：PopoverTrigger 自身也注册一个 Popper Anchor，
          后注册者胜出，锚点在前会被触发器覆盖。 */}
      <PopoverAnchor className="capability-anchor" />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="capability-menu"
      >
        {/* 功能入口（对齐插件菜单）：管理技能 → 设置 → 技能分区 */}
        <div className="capability-menu__actions">
          <button
            type="button"
            className="capability-action"
            onClick={handleOpenManage}
            aria-label="管理技能"
          >
            <Settings2 size={16} className="capability-action__icon" aria-hidden="true" />
            <span className="capability-action__label">管理技能</span>
            <ArrowUpRight
              size={14}
              className="capability-action__arrow"
              aria-hidden="true"
            />
          </button>
        </div>

        {/* 总开关关闭：管理动作会 409，先给出明确指引 */}
        {enabled === false && (
          <div className="capability-menu__notice" role="status">
            技能子系统未启用：请管理员在「设置 → 技能」中开启（或配置 skills.enabled=true）。
          </div>
        )}

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
                onClick={reload}
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="capability-menu__state">
              {query.trim()
                ? '未找到匹配的技能'
                : '暂无可用技能。管理员可在「设置 → 技能」中启用，或配置 skills.auto_discover_dirs。'}
            </div>
          )}

          {!loading &&
            !error &&
            filtered.map((s) => {
              const checked = isSelected(s.name);
              // 未激活（未加入 skills.active 白名单）的技能无法在会话中生效：
              // 禁用勾选并给出「未启用」标签，避免「勾了却没生效」的错觉（U4）。
              const selectable = s.active !== false;
              return (
                <button
                  key={s.name}
                  type="button"
                  className={`capability-item${checked ? ' is-selected' : ''}${
                    selectable ? '' : ' is-disabled'
                  }`}
                  onClick={() => {
                    if (!selectable) return;
                    toggleSkill(s.name);
                  }}
                  disabled={!selectable}
                  aria-pressed={checked}
                  aria-disabled={!selectable}
                  aria-label={
                    selectable ? s.name : `${s.name}（未启用，需管理员在设置中启用）`
                  }
                  title={
                    `${s.name} v${s.version} · ${s.toolCount} 个工具` +
                    (selectable ? '' : ' · 未启用')
                  }
                >
                  <span className="capability-item__icon">
                    <Sparkles size={16} />
                  </span>
                  <span className="capability-item__main">
                    <span className="capability-item__name">
                      {s.name}
                      <span className="capability-item__tag">
                        {s.active ? '已加载' : '未启用'}
                      </span>
                    </span>
                    {s.description && (
                      <span className="capability-item__desc">
                        {s.description}
                      </span>
                    )}
                  </span>
                  <span className="capability-item__meta" aria-hidden="true">
                    {`v${s.version} · ${s.toolCount} 工具`}
                  </span>
                  <Check
                    size={15}
                    className={`capability-item__check${checked ? '' : ' is-hidden'}`}
                  />
                </button>
              );
            })}
        </div>

        <div className="capability-menu__search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能…"
            aria-label="搜索技能"
          />
        </div>

        {/* 语义说明：未勾选 = 服务端默认（全部已启用技能）；勾选 = 本轮仅用所选 */}
        <div className="capability-menu__hint">
          未勾选时使用全部已启用技能；勾选后仅使用所选技能。
        </div>
      </PopoverContent>
    </Popover>
  );
}
