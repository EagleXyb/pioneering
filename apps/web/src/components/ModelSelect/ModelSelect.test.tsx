/**
 * ModelSelect 模型菜单 —— 单行紧凑列表 + 悬停详情卡
 *
 * 覆盖：行内只渲染模型名、详情卡承载描述与事实行、选中项的常驻高亮与绿勾、
 * 选择回调。数据换算见 modelFacts.test.ts，持久化逻辑见 useModelOptions。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from '@testing-library/react';

const optionsMock = vi.hoisted(() => ({
  selectModel: vi.fn(),
  models: [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      description: 'DeepSeek 标准对话模型（默认，速度快、成本低）',
      max_tokens: 128000,
      pricing: { input_price: 0.14, output_price: 0.28 },
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      description: '高性能多模态模型，适用于复杂任务',
      max_tokens: 128000,
      pricing: { input_price: 2.5, output_price: 10 },
    },
    { id: 'no-desc-model', name: '无描述模型' },
  ],
  selectedId: 'deepseek-v4-flash',
}));

vi.mock('@/hooks/useModelOptions', () => ({
  useModelOptions: () => ({
    models: optionsMock.models,
    selectedId: optionsMock.selectedId,
    selectedModel:
      optionsMock.models.find((m) => m.id === optionsMock.selectedId) ?? {
        id: optionsMock.selectedId,
        name: optionsMock.selectedId,
      },
    selectModel: optionsMock.selectModel,
  }),
}));

import { ModelSelect } from './ModelSelect';

/** 键盘打开菜单（Radix 菜单的指针交互在 jsdom 下不可靠，用 Enter 等价路径） */
async function openMenu() {
  render(<ModelSelect mode="chat" />);
  fireEvent.keyDown(screen.getByRole('button', { name: /^选择模型/ }), {
    key: 'Enter',
  });
  return screen.findByRole('menu');
}

function cardOf(name: string): HTMLElement {
  const item = screen.getByRole('menuitem', { name });
  const card = item.querySelector('.model-select__detail');
  if (!card) throw new Error(`${name} 未渲染详情卡`);
  return card as HTMLElement;
}

describe('ModelSelect 菜单列表', () => {
  beforeEach(() => {
    optionsMock.selectModel.mockClear();
    optionsMock.selectedId = 'deepseek-v4-flash';
  });

  it('每项为单行：行内只有模型名，描述移入详情卡（不占行高）', async () => {
    await openMenu();

    const item = screen.getByRole('menuitem', { name: 'DeepSeek V4 Flash' });
    expect(item.querySelector('.model-select__item-row')?.textContent).toBe(
      'DeepSeek V4 Flash',
    );
    // 描述仍在 DOM 中，但位于绝对定位的详情卡内，不参与行布局
    expect(cardOf('DeepSeek V4 Flash')).toHaveTextContent(
      'DeepSeek 标准对话模型（默认，速度快、成本低）',
    );
  });

  it('详情卡：名称 + 描述 + 分隔线 + 事实行（标签 : 值）', async () => {
    await openMenu();
    const card = cardOf('DeepSeek V4 Flash');

    expect(card).toHaveAttribute('aria-hidden', 'true');
    expect(
      within(card).getByText('DeepSeek V4 Flash', {
        selector: '.model-select__detail-title',
      }),
    ).toBeInTheDocument();
    expect(card.querySelector('.model-select__detail-divider')).not.toBeNull();

    const rows = Array.from(
      card.querySelectorAll('.model-select__detail-row'),
    ).map((r) => [
      r.querySelector('dt')?.textContent,
      r.querySelector('dd')?.textContent,
    ]);
    expect(rows).toEqual([
      ['消耗速度', '0.06x 倍率'],
      ['上下文窗口', '128K'],
    ]);
  });

  it('倍率以列表内最高价为基准（最高价模型为 1.00x）', async () => {
    await openMenu();
    expect(cardOf('GPT-4o')).toHaveTextContent('1.00x 倍率');
  });

  it('缺描述与元数据的模型：详情卡只保留名称', async () => {
    await openMenu();
    const card = cardOf('无描述模型');

    expect(within(card).getByText('无描述模型')).toBeInTheDocument();
    expect(card.querySelector('.model-select__detail-desc')).toBeNull();
    expect(card.querySelector('.model-select__detail-divider')).toBeNull();
    expect(card.querySelectorAll('.model-select__detail-row')).toHaveLength(0);
  });

  it('选中项：常驻浅灰底标记 + 绿色对勾', async () => {
    await openMenu();

    const item = screen.getByRole('menuitem', { name: 'DeepSeek V4 Flash' });
    expect(item).toHaveAttribute('data-active', 'true');
    const check = item.querySelector('.model-select__check');
    expect(check).not.toBeNull();
    expect(check?.getAttribute('class')).toContain('lucide-check');
  });

  it('未选中项：无高亮标记、无对勾', async () => {
    await openMenu();

    for (const name of ['GPT-4o', '无描述模型']) {
      const item = screen.getByRole('menuitem', { name });
      expect(item, name).not.toHaveAttribute('data-active');
      expect(item.querySelector('.model-select__check'), name).toBeNull();
    }
  });

  it('每项左侧渲染统一的 tree-palm 图标（不再区分品牌）', async () => {
    await openMenu();

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    for (const item of items) {
      const icon = item.querySelector('.model-select__item-logo svg');
      expect(icon, item.getAttribute('aria-label') ?? '').not.toBeNull();
      expect(icon?.getAttribute('class')).toContain('lucide-tree-palm');
      expect(icon?.getAttribute('stroke-width')).toBe('1.75');
    }
  });

  it('触发胶囊与菜单项使用同一图标尺寸（收起/展开两处视觉重量一致）', async () => {
    render(<ModelSelect mode="chat" />);
    // 菜单打开后触发器会被 Radix 置为 aria-hidden，故先取引用
    const trigger = screen.getByRole('button', { name: /^选择模型/ });
    const triggerIcon = trigger.querySelector('.model-select__logo svg');
    expect(triggerIcon).not.toBeNull();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('menu');

    const itemIcon = screen
      .getAllByRole('menuitem')[0]
      ?.querySelector('.model-select__item-logo svg');
    expect(itemIcon).not.toBeNull();
    // 断言「两者相等」而非写死 18：任一处改尺寸时，测试会失败提醒同步另一处
    expect(triggerIcon?.getAttribute('width')).toBe(itemIcon?.getAttribute('width'));
    expect(triggerIcon?.getAttribute('height')).toBe(itemIcon?.getAttribute('height'));
  });

  it('同一时刻仅一项处于高亮态（详情卡显隐的 CSS 钩子）', async () => {
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    const highlighted = menu.querySelectorAll('[data-highlighted]');
    expect(highlighted).toHaveLength(1);
    // 高亮项即详情卡可见项
    expect(highlighted[0].querySelector('.model-select__detail')).not.toBeNull();
  });

  it('落位属性透传到菜单：jsdom 无布局测量，保持默认右侧并给出宽度上限', async () => {
    const menu = await openMenu();

    expect(menu).toHaveAttribute('data-card-side', 'right');
    expect(menu.style.getPropertyValue('--detail-max-width')).toBe('220px');
    // 卡片与菜单的间距同样由 JS 常量下发，避免 CSS/TS 两处漂移
    expect(menu.style.getPropertyValue('--detail-gap')).not.toBe('');
  });

  it('选择某项后回调上层与 store', async () => {
    await openMenu();

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'GPT-4o' }), {
      key: 'Enter',
    });

    expect(optionsMock.selectModel).toHaveBeenCalledWith('gpt-4o');
  });

  it('菜单关闭后焦点交还触发器（浏览器默认描边即由此出现，已由 CSS 关闭）', async () => {
    // 菜单打开时其余内容被 Radix 置为 aria-hidden，触发器需在打开前取引用
    render(<ModelSelect mode="chat" />);
    const trigger = screen.getByRole('button', { name: /^选择模型/ });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('menu');

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'GPT-4o' }), {
      key: 'Enter',
    });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
