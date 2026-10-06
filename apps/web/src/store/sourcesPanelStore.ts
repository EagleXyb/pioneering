import { create } from 'zustand';
import type { ReferenceItem } from '../types/chat';

/**
 * 联网搜索"参考来源"右侧面板状态（事件总线模式，参照 artifactStore）
 *
 * 消息操作栏的"N 篇来源"按钮只负责 openSources()；面板的显隐、
 * 当前查看的来源（列表态 / 阅读态）全部集中在本 store，
 * 与 conversationStore、消息渲染解耦。切换会话/模式时由调用方 reset()。
 */

interface SourcesPanelState {
  /** 面板是否打开 */
  open: boolean;
  /** 来源所属消息 ID（调试与多消息来源区隔用） */
  messageId: string | null;
  /** 当前面板展示的来源列表 */
  sources: ReferenceItem[];
  /** 阅读态：当前正在预览的来源；null 表示列表态 */
  activeSource: ReferenceItem | null;

  /** 打开某条消息的来源面板（列表态） */
  openSources: (messageId: string, sources: ReferenceItem[]) => void;
  /** 进入某条来源的网页阅读态 */
  previewSource: (source: ReferenceItem) => void;
  /** 从阅读态返回来源列表 */
  backToList: () => void;
  /** 关闭面板并复位 */
  closePanel: () => void;
  /** 切换会话/模式时调用 */
  reset: () => void;
}

export const useSourcesPanelStore = create<SourcesPanelState>((set) => ({
  open: false,
  messageId: null,
  sources: [],
  activeSource: null,

  openSources: (messageId, sources) =>
    set({ open: true, messageId, sources, activeSource: null }),

  previewSource: (source) => set({ activeSource: source }),

  backToList: () => set({ activeSource: null }),

  closePanel: () =>
    set({ open: false, messageId: null, sources: [], activeSource: null }),

  reset: () =>
    set({ open: false, messageId: null, sources: [], activeSource: null }),
}));
