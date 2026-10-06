import { create } from 'zustand';

/* 右侧面板宽度：可拖动调整并持久化 */
export const PIPELINE_WIDTH_KEY = 'task-pipeline-width';
export const DEFAULT_PIPELINE_WIDTH = 320;
export const MIN_PIPELINE_WIDTH = 240;
export const MAX_PIPELINE_WIDTH = 560;

/* chat 模式"参考来源"右侧面板宽度（阅读网页需要更宽） */
export const SOURCES_WIDTH_KEY = 'chat-sources-width';
export const DEFAULT_SOURCES_WIDTH = 420;
export const MIN_SOURCES_WIDTH = 300;
export const MAX_SOURCES_WIDTH = 640;

function loadWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (!v || Number.isNaN(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  } catch {
    return fallback;
  }
}

function loadPipelineWidth(): number {
  return loadWidth(PIPELINE_WIDTH_KEY, DEFAULT_PIPELINE_WIDTH, MIN_PIPELINE_WIDTH, MAX_PIPELINE_WIDTH);
}

function loadSourcesWidth(): number {
  return loadWidth(SOURCES_WIDTH_KEY, DEFAULT_SOURCES_WIDTH, MIN_SOURCES_WIDTH, MAX_SOURCES_WIDTH);
}

interface AppStore {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** 任务模式右侧面板（任务流水线 / Artifact）是否展开 */
  pipelineOpen: boolean;
  togglePipeline: () => void;
  setPipelineOpen: (open: boolean) => void;
  /** 右侧面板宽度（px），可拖动调整 */
  pipelineWidth: number;
  setPipelineWidth: (w: number) => void;
  /** chat 模式参考来源面板宽度（px） */
  sourcesWidth: number;
  setSourcesWidth: (w: number) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  pipelineOpen: true,
  togglePipeline: () => set((s) => ({ pipelineOpen: !s.pipelineOpen })),
  setPipelineOpen: (open) => set({ pipelineOpen: open }),
  pipelineWidth: loadPipelineWidth(),
  setPipelineWidth: (w) => {
    const clamped = Math.min(MAX_PIPELINE_WIDTH, Math.max(MIN_PIPELINE_WIDTH, Math.round(w)));
    try {
      localStorage.setItem(PIPELINE_WIDTH_KEY, String(clamped));
    } catch {
      /* localStorage 不可用时静默降级 */
    }
    set({ pipelineWidth: clamped });
  },
  sourcesWidth: loadSourcesWidth(),
  setSourcesWidth: (w) => {
    const clamped = Math.min(MAX_SOURCES_WIDTH, Math.max(MIN_SOURCES_WIDTH, Math.round(w)));
    try {
      localStorage.setItem(SOURCES_WIDTH_KEY, String(clamped));
    } catch {
      /* localStorage 不可用时静默降级 */
    }
    set({ sourcesWidth: clamped });
  },
}));
