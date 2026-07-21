import { create } from 'zustand';

/* 右侧面板宽度：可拖动调整并持久化 */
export const PIPELINE_WIDTH_KEY = 'task-pipeline-width';
export const DEFAULT_PIPELINE_WIDTH = 320;
export const MIN_PIPELINE_WIDTH = 240;
export const MAX_PIPELINE_WIDTH = 560;

function loadPipelineWidth(): number {
  try {
    const v = Number(localStorage.getItem(PIPELINE_WIDTH_KEY));
    if (!v || Number.isNaN(v)) return DEFAULT_PIPELINE_WIDTH;
    return Math.min(MAX_PIPELINE_WIDTH, Math.max(MIN_PIPELINE_WIDTH, v));
  } catch {
    return DEFAULT_PIPELINE_WIDTH;
  }
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
}));
