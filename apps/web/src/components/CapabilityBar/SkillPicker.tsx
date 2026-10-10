/**
 * SkillPicker —— 输入框底部「技能」选择 chip（pro / task 共用）
 *
 * 参考豆包输入框底部能力入口：透明功能胶囊 + 上弹菜单，
 * 菜单内为技能列表（图标 + 名称 + 描述，多选打勾），底部固定搜索框。
 * 列表数据与勾选状态见 useSkillOptions（列表 GET /skills，按模式持久化）。
 */
import { useMemo, useState } from 'react';
import { Check, Search, Sparkles } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useSkillOptions } from '@/hooks/useSkillOptions';
import type { AppMode } from '@/types';

interface Props {
  mode: AppMode;
  disabled?: boolean;
}

export function SkillPicker({ mode, disabled }: Props) {
  const {
    skills,
    loading,
    error,
    selected,
    isSelected,
    toggleSkill,
    reload,
  } = useSkillOptions(mode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

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
          <Sparkles size={14} />
          技能
          {selected.length > 0 && (
            <span className="capability-chip__badge">{selected.length}</span>
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
                : '暂无可用技能。在 modu-agent 配置 skills.auto_discover_dirs 后重启服务即可接入。'}
            </div>
          )}

          {!loading &&
            !error &&
            filtered.map((s) => {
              const checked = isSelected(s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  className={`capability-item${checked ? ' is-selected' : ''}`}
                  onClick={() => toggleSkill(s.name)}
                  aria-pressed={checked}
                  aria-label={s.name}
                >
                  <span className="capability-item__icon">
                    <Sparkles size={16} />
                  </span>
                  <span className="capability-item__main">
                    <span className="capability-item__name">
                      {s.name}
                      {s.active && (
                        <span className="capability-item__tag">已加载</span>
                      )}
                    </span>
                    {s.description && (
                      <span className="capability-item__desc">
                        {s.description}
                      </span>
                    )}
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
      </PopoverContent>
    </Popover>
  );
}
