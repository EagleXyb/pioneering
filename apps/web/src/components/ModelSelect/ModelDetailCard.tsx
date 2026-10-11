/**
 * 模型详情卡 —— 悬停模型行时展示的浮层
 *
 * 结构：模型名 / 描述 / 分隔线 / 「标签 : 值」事实行。
 * 显隐完全由 CSS 控制（.model-select__item[data-highlighted]），本组件只负责结构，
 * 因此不引入浮层库、不产生额外状态；data-highlighted 同时覆盖鼠标悬停与键盘高亮。
 *
 * 卡片为纯展示内容，对无障碍树隐藏（行内文本已提供模型名），
 * 避免读屏重复播报。
 */
import type { ModelInfo } from '@/api/system';
import type { ModelFact } from './modelFacts';

interface Props {
  model: ModelInfo;
  facts: readonly ModelFact[];
}

export function ModelDetailCard({ model, facts }: Props) {
  return (
    <div className="model-select__detail" aria-hidden="true">
      <div className="model-select__detail-title">{model.name}</div>
      {model.description && (
        <p className="model-select__detail-desc">{model.description}</p>
      )}
      {facts.length > 0 && (
        <>
          <div className="model-select__detail-divider" />
          <dl className="model-select__detail-facts">
            {facts.map((f) => (
              <div key={f.label} className="model-select__detail-row">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
