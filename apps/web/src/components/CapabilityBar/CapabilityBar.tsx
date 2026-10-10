/**
 * CapabilityBar —— 输入框底部「技能 / 插件」选择入口（pro / task 共用）
 *
 * 布局参考豆包输入框底部按钮排布：+ 上传按钮右侧依次排列功能胶囊
 * （技能 / 插件），点击上弹选择菜单（列表 + 底部搜索框），
 * 菜单视觉与 ModelSelect 保持同源。
 */
import { SkillPicker } from './SkillPicker';
import { PluginPicker } from './PluginPicker';
import type { AppMode } from '@/types';
import './CapabilityBar.css';

interface Props {
  mode: AppMode;
  disabled?: boolean;
}

export function CapabilityBar({ mode, disabled }: Props) {
  return (
    <>
      <SkillPicker mode={mode} disabled={disabled} />
      <PluginPicker disabled={disabled} />
    </>
  );
}
