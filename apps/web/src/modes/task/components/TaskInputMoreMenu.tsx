import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Camera,
  ChevronRight,
  FolderOpen,
  Globe,
  History,
  Image,
  Library,
  MessageSquare,
  NotebookText,
  Paperclip,
  Plus,
  Quote,
  Upload,
  Zap,
} from 'lucide-react';

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

interface SubItem {
  id: string;
  label: string;
  icon: IconComponent;
}

interface MainItem {
  id: string;
  label: string;
  icon: IconComponent;
  sub?: SubItem[];
}

// 任务模式「+」按钮弹出的「更多工具」下拉菜单
// 基于「图片、文件、技能、引用、知识库」五大必备能力收敛为 5 项：
// - 图片：上传图片、截图
// - 文件：上传文件、选择已有文件
// - 技能：打开技能/指令面板
// - 引用：引用网页、引用笔记、引用其他对话
// - 知识库：全部知识库、最近使用
const MAIN_ITEMS: MainItem[] = [
  {
    id: 'image',
    label: '图片',
    icon: Image,
    sub: [
      { id: 'image-upload', label: '上传图片', icon: Upload },
      { id: 'image-screenshot', label: '截图', icon: Camera },
    ],
  },
  {
    id: 'file',
    label: '文件',
    icon: FolderOpen,
    sub: [
      { id: 'file-upload', label: '上传文件', icon: Upload },
      { id: 'file-existing', label: '选择已有文件', icon: Paperclip },
    ],
  },
  { id: 'skill', label: '技能', icon: Zap },
  {
    id: 'quote',
    label: '引用',
    icon: Quote,
    sub: [
      { id: 'quote-web', label: '引用网页', icon: Globe },
      { id: 'quote-note', label: '引用笔记', icon: NotebookText },
      { id: 'quote-dialog', label: '引用其他对话', icon: MessageSquare },
    ],
  },
  {
    id: 'kb',
    label: '知识库',
    icon: Library,
    sub: [
      { id: 'kb-all', label: '全部知识库', icon: Library },
      { id: 'kb-recent', label: '最近使用', icon: History },
    ],
  },
];

const ITEM_H = 40; // 每个菜单项高度
const MAIN_PADDING = 6; // 主菜单上下内边距
const POPOVER_OFFSET = 8; // 弹层与按钮的间距
const POPOVER_GAP = 4; // 主菜单与子菜单的间距

interface Props {
  /** 点击某个菜单项后的回调，便于接入后续真实动作（上传/截图/引用等） */
  onAction?: (actionId: string) => void;
}

/**
 * 任务模式输入框左下角的「+」按钮，点击后在按钮上方弹出一个工具下拉菜单。
 * - 主菜单 5 项，与「图片、文件、技能、引用、知识库」一一对应
 * - 带 ▸ 的项悬停展开二级子菜单
 * - 使用 fixed 定位到按钮上方，避免被输入区或父容器 overflow 裁剪
 * - 点击外部 / Esc / 滚动 / 窗口缩放 自动关闭
 */
export function TaskInputMoreMenu({ onAction }: Props) {
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
    // 估算主菜单宽度以做左右边界保护
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

  const hoveredIdx = hoverId ? MAIN_ITEMS.findIndex((i) => i.id === hoverId) : -1;
  const hovered = hoveredIdx >= 0 ? MAIN_ITEMS[hoveredIdx] : null;

  const handleItem = (item: { id: string }) => {
    onAction?.(item.id);
    close();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="task-input-toolbar-btn task-input-more-btn"
        aria-label="更多工具"
        title="更多工具"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus className="h-5 w-5" strokeWidth={1.8} />
      </button>

      {open && pos && (
        <div
          ref={popRef}
          className="task-input-more-pop"
          role="menu"
          style={{ left: pos.left, bottom: pos.bottom }}
        >
          <div className="task-input-more-main">
            {MAIN_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  className={
                    'task-input-more-item' +
                    (item.sub ? ' has-sub' : '') +
                    (hoverId === item.id ? ' active' : '')
                  }
                  role="menuitem"
                  tabIndex={-1}
                  onMouseEnter={() => setHoverId(item.sub ? item.id : null)}
                  onClick={() => {
                    if (!item.sub) handleItem(item);
                  }}
                >
                  <Icon className="task-input-more-item-icon" />
                  <span className="task-input-more-item-label">{item.label}</span>
                  {item.sub && <ChevronRight className="task-input-more-chevron" />}
                </div>
              );
            })}
          </div>

          {hovered?.sub && (
            <div
              className="task-input-more-sub"
              role="menu"
              style={{ top: MAIN_PADDING + hoveredIdx * ITEM_H }}
            >
              {hovered.sub.map((s) => {
                const SIcon = s.icon;
                return (
                  <div
                    key={s.id}
                    className="task-input-more-item"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleItem(s)}
                  >
                    <SIcon className="task-input-more-item-icon" />
                    <span className="task-input-more-item-label">{s.label}</span>
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
