/**
 * 会话列表项（阶段 3.4 从 Sidebar.tsx 拆出）
 * - 重命名/归档/恢复/置顶/分享/删除逻辑零改动平移
 * - 自绘点击外部关闭的下拉菜单 → shadcn DropdownMenu（radix portal 自动处理
 *   外部点击/定位/键盘导航，menuOpen/menuRef/handleClickOutside 全部移除）
 * - 内联手写 SVG → lucide
 */
import { useState, useRef, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Archive,
  Check,
  CornerUpLeft,
  Ellipsis,
  Folder,
  FolderInput,
  MessageSquare,
  Pencil,
  Pin,
  RotateCcw,
  Share,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MODE_ICONS } from '@/components/icons/modeIcons';
import type { Conversation } from '../../store/conversationStore';
import type { SidebarGroup } from '../../store/sidebarGroupsStore';

interface SidebarItemProps {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onRename: (title: string) => void;
  onRestore?: () => void;
  /** 可选的分组列表（用于「移动到分组」子菜单） */
  groups?: SidebarGroup[];
  /** 该会话当前所属分组 id */
  currentGroupId?: string;
  /** 移动到分组（null = 移出分组） */
  onMoveToGroup?: (groupId: string | null) => void;
}

export function SidebarItem({
  conv,
  isActive,
  onSelect,
  onDelete,
  onArchive,
  onRename,
  onRestore,
  groups = [],
  currentGroupId,
  onMoveToGroup,
}: SidebarItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const startRename = () => {
    setRenameValue(conv.title);
    setIsRenaming(true);
  };

  const commitRename = () => {
    setIsRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conv.title) {
      onRename(trimmed);
    }
  };

  const cancelRename = () => {
    setIsRenaming(false);
  };

  // 重命名输入框上避免点击冒泡触发会话切换
  const stopSelect = (e: ReactMouseEvent) => e.stopPropagation();

  const ModeIcon = MODE_ICONS[conv.mode] ?? MessageSquare;

  return (
    <div
      className={`sidebar-item${isActive ? ' active' : ''}`}
      role="button"
      tabIndex={0}
      title={conv.title}
      onClick={isRenaming ? undefined : onSelect}
      onKeyDown={(e) => {
        if (isRenaming) return;
        if (e.key === 'Enter') onSelect();
      }}
    >
      <div className="sidebar-item-inner">
        <span className="sidebar-item-mode-tag">
          <ModeIcon size={12} />
        </span>
        {isRenaming ? (
          <input
            ref={inputRef}
            className="sidebar-item-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            onClick={stopSelect}
          />
        ) : (
          <div className="sidebar-item-title" onDoubleClick={startRename}>
            {conv.title}
          </div>
        )}
      </div>
      <div className="sidebar-item-menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="sidebar-item-menu-trigger"
              aria-label="更多操作"
              title="更多操作"
              onClick={stopSelect}
            >
              <Ellipsis size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className="sidebar-menu"
          >
            <DropdownMenuItem onSelect={startRename}>
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast.info('置顶功能开发中')}>
              <Pin />
              置顶
            </DropdownMenuItem>
            {onRestore ? (
              <DropdownMenuItem onSelect={onRestore}>
                <RotateCcw />
                恢复
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onArchive}>
                <Archive />
                归档
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => toast.info('分享功能开发中')}>
              <Share />
              分享
            </DropdownMenuItem>
            {/* 移动到分组：子菜单列出全部分组，末项为「移出分组」 */}
            {onMoveToGroup && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput />
                  移动到分组
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="sidebar-menu">
                  {groups.length === 0 && (
                    <DropdownMenuItem disabled>
                      暂无分组，请在侧边栏新建
                    </DropdownMenuItem>
                  )}
                  {groups.map((g) => (
                    <DropdownMenuItem
                      key={g.id}
                      onSelect={() => onMoveToGroup(g.id)}
                    >
                      <Folder />
                      {g.name}
                      {currentGroupId === g.id && (
                        <Check className="ml-auto" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  {currentGroupId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onMoveToGroup(null)}>
                        <CornerUpLeft />
                        移出分组
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                // 同步清除 body pointer-events，避免键盘操作菜单后挂载
                // ConfirmDialog 造成 Radix 锁定状态残留（见 AccountPopover 说明）
                document.body.style.pointerEvents = '';
                onDelete();
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
