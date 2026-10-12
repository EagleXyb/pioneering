/**
 * AddPluginDialog 单元测试 —— 「添加插件」表单
 *
 * 覆盖：表单渲染（stdio 字段集）、必填校验、stdio 参数组装与成功关闭、
 * 失败保持打开、连接失败的 warning 反馈、环境变量格式拦截。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import { AddPluginDialog } from './AddPluginDialog';
import type { AddMcpServerInput } from '@/api/mcp';
import type { AddPluginResult } from '@/hooks/useMcpPlugins';

beforeEach(() => {
  vi.clearAllMocks();
});

/** 渲染对话框；result 为 onSubmit 的固定返回值（用例按需覆盖） */
function renderDialog(
  result: AddPluginResult = { ok: true, message: '已添加插件 demo' },
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn(async (_input: AddMcpServerInput) => result);
  render(
    <AddPluginDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />,
  );
  return { onOpenChange, onSubmit };
}

describe('AddPluginDialog', () => {
  it('渲染表单：名称 / 启动命令 / 参数 / 环境变量（stdio 默认）', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('添加插件')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toBeInTheDocument();
    expect(screen.getByLabelText('启动命令')).toBeInTheDocument();
    expect(screen.getByLabelText('命令参数')).toBeInTheDocument();
    expect(screen.getByLabelText('环境变量')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument();
  });

  it('名称为空提交：给出错误且不调用 onSubmit', async () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(await screen.findByText('请填写插件名称')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('stdio 提交：组装 command/args/env 并成功后关闭对话框', async () => {
    const { onSubmit, onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByLabelText('启动命令'), {
      target: { value: 'npx' },
    });
    fireEvent.change(screen.getByLabelText('命令参数'), {
      target: { value: '-y\n@scope/pkg' },
    });
    fireEvent.change(screen.getByLabelText('环境变量'), {
      target: { value: 'TOKEN=abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'demo',
      transport: 'stdio',
      autoStart: true,
      command: 'npx',
      args: ['-y', '@scope/pkg'],
      env: { TOKEN: 'abc' },
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastMock.success).toHaveBeenCalledWith('已添加插件 demo');
  });

  it('提交失败（重名等）：展示后端错误并保持对话框打开', async () => {
    const { onOpenChange } = renderDialog({
      ok: false,
      message: '插件 demo 已存在',
    });

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByLabelText('启动命令'), {
      target: { value: 'npx' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(await screen.findByText('插件 demo 已存在')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('配置写入但连接失败：warning 提示且仍关闭对话框', async () => {
    const { onOpenChange } = renderDialog({
      ok: true,
      connectFailed: true,
      message: '插件 demo 已添加，但连接失败：connect timeout',
    });

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByLabelText('启动命令'), {
      target: { value: 'npx' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() =>
      expect(toastMock.warning).toHaveBeenCalledWith(
        '插件 demo 已添加，但连接失败：connect timeout',
      ),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('环境变量格式非法：前端拦截并提示', async () => {
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByLabelText('启动命令'), {
      target: { value: 'npx' },
    });
    fireEvent.change(screen.getByLabelText('环境变量'), {
      target: { value: 'BADLINE' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(
      await screen.findByText('环境变量格式不正确，应为每行 KEY=VALUE'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
