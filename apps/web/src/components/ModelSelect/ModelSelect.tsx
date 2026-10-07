/**
 * ModelSelect —— 输入框模型选择胶囊（chat / pro / task 三模式共用）
 *
 * 视觉：浅灰圆角胶囊 + 品牌标识 + 当前模型名 + 下箭头，
 * 点击上弹模型菜单（名称 + 描述，当前项打勾）。
 * 数据与选择状态由 useModelOptions 管理（列表来自 /system/models，
 * 选择按模式持久化到 localStorage）。
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check } from 'lucide-react';
import { useModelOptions } from '@/hooks/useModelOptions';
import type { AppMode } from '@/types';
import './ModelSelect.css';

/** 品牌标识：deepseek 为鲸形曲线，gpt 为六边节点，其余用通用菱形光斑 */
function BrandMark({ id, size = 22 }: { id: string; size?: number }) {
  if (id.startsWith('deepseek')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={4.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* 尾鳍（两片，交汇于尾柄） */}
        <path d="M44 5 36.5 12.5 45 17" />
        {/* 背部大弧线 → 头部 → 腹部回勾，整体呈 C 形鲸身 */}
        <path d="M36.5 12.5C28 14 17 18 12.5 27.5 9 34.5 12.5 39.5 19 39c7-0.6 12-5.2 12-11" />
        {/* 眼睛 */}
        <circle cx="15.5" cy="33.5" r="1.7" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (id.startsWith('gpt')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.4}
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M30 5.5 39 10.75v10.5L30 26.5l-9-5.25v-10.5L30 5.5Z" />
        <path d="M18 21.5 9 26.75v10.5L18 42.5l9-5.25v-10.5L18 21.5Z" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </svg>
  );
}

interface Props {
  mode: AppMode;
  disabled?: boolean;
  /** 受控选中项（需读取所选模型发送请求时由外层传入） */
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function ModelSelect({ mode, disabled, selectedId, onSelect }: Props) {
  const modelOptions = useModelOptions(mode);
  const models = modelOptions.models;
  const activeId = selectedId ?? modelOptions.selectedId;
  const selectedModel =
    models.find((m) => m.id === activeId) ?? {
      id: activeId,
      name: activeId,
    };

  const handleSelect = (id: string) => {
    modelOptions.selectModel(id);
    onSelect?.(id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="model-select__trigger"
          disabled={disabled}
          aria-label={`选择模型，当前：${selectedModel.name}`}
          title="选择模型"
        >
          <span className="model-select__logo">
            <BrandMark id={selectedModel.id} />
          </span>
          <span className="model-select__name">{selectedModel.name}</span>
          <svg
            className="model-select__chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="model-select__menu"
      >
        {models.map((m) => {
          const active = m.id === activeId;
          return (
            <DropdownMenuItem
              key={m.id}
              className="model-select__item"
              onSelect={() => handleSelect(m.id)}
              aria-label={m.name}
            >
              <span className="model-select__item-logo">
                <BrandMark id={m.id} size={18} />
              </span>
              <span className="model-select__item-main">
                <span className="model-select__item-name">{m.name}</span>
                {m.description && (
                  <span className="model-select__item-desc">
                    {m.description}
                  </span>
                )}
              </span>
              <Check
                size={15}
                className={`model-select__check${active ? '' : ' is-hidden'}`}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
