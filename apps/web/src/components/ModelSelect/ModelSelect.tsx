/**
 * ModelSelect —— 输入框模型选择胶囊（chat / pro / task 三模式共用）
 *
 * 视觉：浅灰圆角胶囊 + 统一模型图标 + 当前模型名 + 下箭头，
 * 点击上弹模型菜单：单行紧凑列表（统一模型图标 + 名称 + 选中绿勾），
 * 选中项常驻浅灰底；模型描述不占行高，挂在悬停提示上。
 * 数据与选择状态由 useModelOptions 管理（列表来自 /system/models，
 * 选择按模式持久化到 localStorage）。
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, ChevronDown, TreePalm } from 'lucide-react';
import { useModelOptions } from '@/hooks/useModelOptions';
import type { AppMode } from '@/types';
import { buildModelFacts } from './modelFacts';
import { ModelDetailCard } from './ModelDetailCard';
import {
  CARD_GAP,
  CARD_WIDTH,
  resolveCardPlacement,
  type CardPlacement,
} from './cardPlacement';
import './ModelSelect.css';

interface Props {
  mode: AppMode;
  disabled?: boolean;
  /** 受控选中项（需读取所选模型发送请求时由外层传入） */
  selectedId?: string;
  onSelect?: (id: string) => void;
}

/** 定位完成前的默认落位：菜单右侧（与参照图一致） */
const DEFAULT_PLACEMENT: CardPlacement = { side: 'right', maxWidth: CARD_WIDTH };

export function ModelSelect({ mode, disabled, selectedId, onSelect }: Props) {
  const modelOptions = useModelOptions(mode);
  const models = modelOptions.models;
  const activeId = selectedId ?? modelOptions.selectedId;
  const selectedModel =
    models.find((m) => m.id === activeId) ?? {
      id: activeId,
      name: activeId,
    };

  // 详情卡以菜单为参照定位，故只需在菜单位置变化时重算落位
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CardPlacement>(DEFAULT_PLACEMENT);

  const syncPlacement = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return; // 菜单未打开（内容未挂载）
    const rect = menu.getBoundingClientRect();
    if (!rect.width) return; // Radix 尚未完成 popper 定位
    const next = resolveCardPlacement({
      menuLeft: rect.left,
      menuRight: rect.right,
      viewportWidth: window.innerWidth,
    });
    // 相同结果返回原对象，避免滚动时逐帧触发重渲染
    setPlacement((prev) =>
      prev.side === next.side && prev.maxWidth === next.maxWidth ? prev : next,
    );
  }, []);

  useEffect(() => {
    window.addEventListener('resize', syncPlacement);
    // Radix 会在滚动时重新定位菜单，用捕获阶段覆盖内部滚动容器
    window.addEventListener('scroll', syncPlacement, true);
    return () => {
      window.removeEventListener('resize', syncPlacement);
      window.removeEventListener('scroll', syncPlacement, true);
    };
  }, [syncPlacement]);

  const handleSelect = (id: string) => {
    modelOptions.selectModel(id);
    onSelect?.(id);
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // 打开后 Radix 才挂载并定位内容，下一帧再测量
        if (open) requestAnimationFrame(syncPlacement);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="model-select__trigger"
          disabled={disabled}
          aria-label={`选择模型，当前：${selectedModel.name}`}
          title="选择模型"
        >
          <span className="model-select__logo">
            {/* 与菜单项同尺寸（16px）：收起态与展开态两处图标视觉重量一致 */}
            <TreePalm size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="model-select__name">{selectedModel.name}</span>
          <ChevronDown size={14} className="model-select__chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={menuRef}
        align="end"
        side="top"
        sideOffset={8}
        className="model-select__menu"
        /* 落位由 JS 计算后透传给 CSS（见 cardPlacement.ts） */
        data-card-side={placement.side}
        style={
          {
            '--detail-max-width': `${placement.maxWidth}px`,
            '--detail-gap': `${CARD_GAP}px`,
          } as CSSProperties
        }
        /* 指针进入 / 键盘聚焦时菜单必已定位，再同步一次以防打开瞬间测量偏早 */
        onPointerEnter={syncPlacement}
        onFocusCapture={syncPlacement}
      >
        {models.map((m) => {
          const active = m.id === activeId;
          // P3：status=sunset 的模型不可选，悬停详情卡给出下线原因
          const unavailable = m.status === 'sunset';
          return (
            <DropdownMenuItem
              key={m.id}
              className="model-select__item"
              /* 选中态：常驻浅灰底（CSS 用 [data-active] 命中） */
              data-active={active || undefined}
              data-disabled={unavailable || undefined}
              disabled={unavailable}
              title={unavailable ? m.disable_reason : undefined}
              onSelect={() => {
                if (unavailable) return;
                handleSelect(m.id);
              }}
              aria-label={
                unavailable
                  ? `${m.name}（不可用${m.disable_reason ? `：${m.disable_reason}` : ''}）`
                  : m.name
              }
            >
              {/* 行本体：单行（标识 + 名称 + 选中勾）；详情卡绝对定位，不占行高 */}
              <span className="model-select__item-row">
                <span className="model-select__item-logo">
                  {/* 菜单内所有模型统一用 tree-palm，不按品牌区分；
                      16px / 1.75 线宽与触发胶囊同规格 */}
                  <TreePalm size={16} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="model-select__item-name">{m.name}</span>
                {active && (
                  <Check
                    size={15}
                    className="model-select__check"
                    aria-hidden="true"
                  />
                )}
              </span>
              <ModelDetailCard model={m} facts={buildModelFacts(m, models)} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
