/**
 * 通用「更多工具」菜单（pro / task 共用，T4.5 收敛）
 *
 * 条目由调用方通过 props 提供（叶子项携带 onAction 回调），
 * 组件本身只负责：弹层定位、二级悬停子菜单、外部点击/Esc/滚动关闭。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, Plus, type LucideIcon } from 'lucide-react';

export interface MoreMenuLeaf {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 点击叶子项时执行；缺省仅关闭菜单 */
  onAction?: () => void;
  /** 禁用态（如流式中） */
  disabled?: boolean;
}

export interface MoreMenuGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  children?: MoreMenuLeaf[];
  /** 无 children 时点击触发 */
  onAction?: () => void;
}

interface Props {
  items: MoreMenuGroup[];
  /** 触发按钮额外类名（各模式样式钩子） */
  triggerClassName?: string;
  /** 弹层类名前缀（pro-input / task-input 样式） */
  popClassName?: string;
  /** 触发按钮禁用 */
  disabled?: boolean;
  ariaLabel?: string;
}

const ITEM_H = 40;
const MAIN_PADDING = 6;
const POPOVER_OFFSET = 8;

export function MoreMenu({
  items,
  triggerClassName,
  popClassName = 'pro-input',
  disabled,
  ariaLabel = '更多工具',
}: Props) {
  const [open, setOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setHoverId(null);
  };

  const updatePos = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const minLeft = 8;
    const maxLeft = Math.max(minLeft, window.innerWidth - 220 - 8);
    const left = Math.min(Math.max(r.left, minLeft), maxLeft);
    const bottom = window.innerHeight - r.top + POPOVER_OFFSET;
    setPos({ left, bottom });
  };

  useLayoutEffect(() => {
    if (open) updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const hoveredIdx = hoverId ? items.findIndex((i) => i.id === hoverId) : -1;
  const hovered = hoveredIdx >= 0 ? items[hoveredIdx] : null;

  const runLeaf = (leaf: MoreMenuLeaf) => {
    if (leaf.disabled) return;
    leaf.onAction?.();
    close();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${popClassName}-toolbar-btn ${popClassName}-more-btn${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus className="h-5 w-5" strokeWidth={1.8} />
      </button>

      {open && pos && (
        <div
          ref={popRef}
          className={`${popClassName}-more-pop`}
          role="menu"
          style={{ left: pos.left, bottom: pos.bottom }}
        >
          <div className={`${popClassName}-more-main`}>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  className={
                    `${popClassName}-more-item` +
                    (item.children ? ' has-sub' : '') +
                    (hoverId === item.id ? ' active' : '')
                  }
                  role="menuitem"
                  tabIndex={-1}
                  onMouseEnter={() => setHoverId(item.children ? item.id : null)}
                  onClick={() => {
                    if (!item.children) {
                      item.onAction?.();
                      close();
                    }
                  }}
                >
                  <Icon className={`${popClassName}-more-item-icon`} />
                  <span className={`${popClassName}-more-item-label`}>{item.label}</span>
                  {item.children && <ChevronRight className={`${popClassName}-more-chevron`} />}
                </div>
              );
            })}
          </div>

          {hovered?.children && (
            <div
              className={`${popClassName}-more-sub`}
              role="menu"
              style={{ top: MAIN_PADDING + hoveredIdx * ITEM_H }}
            >
              {hovered.children.map((s) => {
                const SIcon = s.icon;
                return (
                  <div
                    key={s.id}
                    className={`${popClassName}-more-item${s.disabled ? ' is-disabled' : ''}`}
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={s.disabled || undefined}
                    onClick={() => runLeaf(s)}
                  >
                    <SIcon className={`${popClassName}-more-item-icon`} />
                    <span className={`${popClassName}-more-item-label`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
