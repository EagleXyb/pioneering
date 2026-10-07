/**
 * 「更多工具」条目工厂（pro / task 共用，T4.5）
 *
 * 五大能力分组：图片 / 文件 / 技能 / 引用 / 知识库。
 * 调用方传入各动作回调与禁用态；尚未接线的动作省略回调（点击仅关菜单）。
 */
import {
  Camera,
  FolderOpen,
  Globe,
  History,
  Image,
  Library,
  MessageSquare,
  NotebookText,
  Paperclip,
  Quote,
  Upload,
  Zap,
} from 'lucide-react';
import type { MoreMenuGroup } from './MoreMenu';

export interface MoreMenuHandlers {
  /** 上传图片（触发文件选择框） */
  onUploadImage?: () => void;
  /** 截图 */
  onScreenshot?: () => void;
  /** 上传文件 */
  onUploadFile?: () => void;
  /** 选择已有文件 */
  onPickExistingFile?: () => void;
  /** 技能/指令面板 */
  onOpenSkills?: () => void;
  /** 引用网页 */
  onQuoteWeb?: () => void;
  /** 引用笔记 */
  onQuoteNote?: () => void;
  /** 引用其他对话 */
  onQuoteDialog?: () => void;
  /** 全部知识库 */
  onOpenAllKb?: () => void;
  /** 最近使用知识库 */
  onOpenRecentKb?: () => void;
  /** 流式中：全部条目禁用 */
  disabled?: boolean;
}

export function buildMoreMenuItems(h: MoreMenuHandlers): MoreMenuGroup[] {
  const d = h.disabled ?? false;
  return [
    {
      id: 'image',
      label: '图片',
      icon: Image,
      children: [
        { id: 'image-upload', label: '上传图片', icon: Upload, onAction: h.onUploadImage, disabled: d },
        { id: 'image-screenshot', label: '截图', icon: Camera, onAction: h.onScreenshot, disabled: d },
      ],
    },
    {
      id: 'file',
      label: '文件',
      icon: FolderOpen,
      children: [
        { id: 'file-upload', label: '上传文件', icon: Upload, onAction: h.onUploadFile, disabled: d },
        { id: 'file-existing', label: '选择已有文件', icon: Paperclip, onAction: h.onPickExistingFile, disabled: d },
      ],
    },
    { id: 'skill', label: '技能', icon: Zap, onAction: h.onOpenSkills },
    {
      id: 'quote',
      label: '引用',
      icon: Quote,
      children: [
        { id: 'quote-web', label: '引用网页', icon: Globe, onAction: h.onQuoteWeb, disabled: d },
        { id: 'quote-note', label: '引用笔记', icon: NotebookText, onAction: h.onQuoteNote, disabled: d },
        { id: 'quote-dialog', label: '引用其他对话', icon: MessageSquare, onAction: h.onQuoteDialog, disabled: d },
      ],
    },
    {
      id: 'kb',
      label: '知识库',
      icon: Library,
      children: [
        { id: 'kb-all', label: '全部知识库', icon: Library, onAction: h.onOpenAllKb, disabled: d },
        { id: 'kb-recent', label: '最近使用', icon: History, onAction: h.onOpenRecentKb, disabled: d },
      ],
    },
  ];
}
