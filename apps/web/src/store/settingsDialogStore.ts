/**
 * 设置对话框全局开关（事件总线模式，参照 sourcesPanelStore）
 *
 * 原先由 AccountPopover 局部 state 承载；插件菜单「管理插件」等
 * 其它入口也需要唤起同一实例，故提升为全局 store：
 * AppLayout 挂载唯一 <SettingsDialog>，各入口只负责 openSettings(section)。
 */
import { create } from 'zustand';

interface SettingsDialogState {
  /** 对话框是否可见 */
  open: boolean;
  /** 打开时定位的分区 id（general / chat / usage / mcp / account / data / help / about；外观、通知已并入 general） */
  section: string;
  /** 打开设置并定位分区（缺省 general） */
  openSettings: (section?: string) => void;
  /** 关闭设置 */
  closeSettings: () => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  section: 'general',
  openSettings: (section = 'general') => set({ open: true, section }),
  closeSettings: () => set({ open: false }),
}));
