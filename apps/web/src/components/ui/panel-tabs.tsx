import './panel-tabs.css';

export interface PanelTabItem {
  key: string;
  label: string;
}

interface Props {
  tabs: PanelTabItem[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}

/**
 * 右侧面板 tab 组（任务流水线 / 推理过程 ↔ 执行轨迹）。
 * pro / task 两模式右栏头部共用，纯展示组件，选中态由调用方受控。
 */
export function PanelTabs({ tabs, value, onChange, ariaLabel }: Props) {
  return (
    <div className="panel-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className={`panel-tab${value === t.key ? ' panel-tab--active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
