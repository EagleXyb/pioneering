import { create } from 'zustand';

/**
 * Artifact 预览面板状态管理
 *
 * 设计参考：apps/web/docs/输入框实现深度分析.md §2.4（store 作为事件总线） +
 * apps/web/docs/lib 中 OpenWebUI 的 artifactContents/showArtifacts 模式。
 *
 * 本 store 只承载任务模式预览面板所需的最小状态：
 *   - activeArtifact：当前正在预览的 artifact（含来源 messageId，用于反向联动）
 *   - highlightMessageId：临时高亮消息 ID，由 useScrollToMessage 消费后自动清除
 *
 * 与 conversationStore 解耦：artifact 状态只活在任务模式生命周期内，
 * 切换会话/模式时由调用方主动调用 closeArtifact() 清理。
 */

export type ArtifactType = 'html' | 'svg' | 'code';

export interface ActiveArtifact {
  /** 来源消息 ID，用于反向联动（点击"跳转到源消息"） */
  messageId: string;
  /** artifact 类型，决定渲染策略 */
  type: ArtifactType;
  /** artifact 原始内容（HTML/SVG 源码或代码文本） */
  content: string;
  /** 语言标签（仅 type==='code' 时有意义，用于代码高亮显示） */
  language?: string;
  /** 创建时间戳，用于调试与去重 */
  openedAt: number;
}

interface ArtifactState {
  /** 当前预览的 artifact；为 null 时面板关闭 */
  activeArtifact: ActiveArtifact | null;
  /** 临时高亮的消息 ID；消费方应读取后立即 clearHighlight */
  highlightMessageId: string | null;

  /** 打开 artifact 预览（携带来源 messageId） */
  openArtifact: (a: Omit<ActiveArtifact, 'openedAt'>) => void;
  /** 关闭预览 */
  closeArtifact: () => void;
  /** 触发"跳转到源消息"——设置 highlightMessageId 供消息列表消费 */
  highlightMessage: (messageId: string) => void;
  /** 消息列表消费完高亮后调用，避免重复触发 */
  clearHighlight: () => void;
  /** 切换会话/模式时调用，重置全部状态 */
  reset: () => void;
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  activeArtifact: null,
  highlightMessageId: null,

  openArtifact: (a) =>
    set({
      activeArtifact: { ...a, openedAt: Date.now() },
      // 打开新 artifact 时清掉残留的高亮信号
      highlightMessageId: null,
    }),

  closeArtifact: () => set({ activeArtifact: null, highlightMessageId: null }),

  highlightMessage: (messageId) => set({ highlightMessageId: messageId }),

  clearHighlight: () => set({ highlightMessageId: null }),

  reset: () => set({ activeArtifact: null, highlightMessageId: null }),
}));
