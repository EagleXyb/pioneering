/**
 * P3 回归：能力清单驱动的模型选择器
 *
 * - status=sunset 的模型置灰、不可选择
 * - 详情卡展示下线原因
 * - 可用模型仍可正常选择
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const optionsMock = vi.hoisted(() => ({
  selectModel: vi.fn(),
  models: [
    {
      id: 'fast',
      model_id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      status: 'active' as const,
      max_tokens: 128000,
    },
    {
      id: 'legacy',
      model_id: 'legacy-model',
      name: 'Legacy-Model',
      status: 'sunset' as const,
      disable_reason: '已由 Fast 替代',
    },
  ],
  selectedId: 'fast',
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

async function openMenu() {
  render(<ModelSelect mode="chat" />);
  fireEvent.keyDown(screen.getByRole('button', { name: /^选择模型/ }), {
    key: 'Enter',
  });
  return screen.findByRole('menu');
}

describe('ModelSelect —— 能力状态（P3）', () => {
  beforeEach(() => {
    optionsMock.selectModel.mockReset();
  });

  it('下线模型置灰且点击无效，详情卡给出原因', async () => {
    const menu = await openMenu();
    const items = within(menu).getAllByRole('menuitem');
    const legacy = items.find((el) => el.textContent?.includes('Legacy-Model'))!;

    expect(legacy).toHaveAttribute('aria-disabled', 'true');
    expect(legacy).toHaveAttribute('title', '已由 Fast 替代');
    expect(legacy.textContent).toContain('已下线（已由 Fast 替代）');

    fireEvent.click(legacy);
    expect(optionsMock.selectModel).not.toHaveBeenCalled();
  });

  it('可用模型仍可正常选择', async () => {
    const menu = await openMenu();
    const fast = within(menu)
      .getAllByRole('menuitem')
      .find((el) => el.textContent?.includes('DeepSeek-V4-Flash'))!;

    fireEvent.click(fast);
    expect(optionsMock.selectModel).toHaveBeenCalledWith('fast');
  });
});
