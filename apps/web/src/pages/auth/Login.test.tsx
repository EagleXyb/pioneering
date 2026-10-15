import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './Login';
import { loginApi } from '../../api/auth-api';

/** 登录页会真实调用 /auth/login，测试中统一替身，避免触网 */
vi.mock('../../api/auth-api', () => ({
  loginApi: vi.fn(),
  registerApi: vi.fn(),
  logoutApi: vi.fn(),
  getProfileApi: vi.fn(),
}));

/** 登录页依赖 useNavigate，需包一层 Router */
function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('Login 页（严格对齐 docs/login-app 原型）', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(loginApi).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染品牌叙事与登录表单关键元素', () => {
    renderLogin();
    // 布局层（AuthLayout）
    expect(screen.getByText('登录工作台')).toBeTruthy();
    expect(screen.getByText('Sign in to NOVA Workspace')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /都有智能体在场/ })).toBeTruthy();
    expect(screen.getByText('Agent Runtime · 已就绪')).toBeTruthy();
    expect(screen.getByText('多智能体编排')).toBeTruthy();
    expect(screen.getByText('全链路审计')).toBeTruthy();
    expect(screen.getByText('私有化部署')).toBeTruthy();
    // 顶栏与底栏
    expect(screen.getByText('已通过等保三级 · ISO 27001 认证')).toBeTruthy();
    expect(screen.getByRole('button', { name: '切换到深色主题' })).toBeTruthy();
    expect(screen.getByText('© 2026 创新创造智能体 NOVA · 保留所有权利')).toBeTruthy();
    // 表单层
    expect(screen.getByLabelText('用户名 / 邮箱')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Login/ })).toBeTruthy();
    expect(screen.getByText('记住登录状态')).toBeTruthy();
    expect(screen.getByText('全链路 TLS 1.3 加密传输，凭证不落盘')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '账号密码登录' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '验证码登录' })).toBeTruthy();
  });

  it('表单完全为空时主按钮置灰，输入任一字段后放行（原型 refreshSubmitAvailability）', () => {
    renderLogin();
    const submit = screen.getByRole('button', { name: /Login/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('用户名 / 邮箱'), {
      target: { value: 'design@nova-ai.com' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('只填账号即提交时提示密码必填，且不发起登录请求', () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('用户名 / 邮箱'), {
      target: { value: 'design@nova-ai.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Login/ }));

    expect(screen.getByText('密码为必填项')).toBeTruthy();
    expect(loginApi).not.toHaveBeenCalled();
  });

  it('账号失焦校验：用户名不做格式拦截', () => {
    renderLogin();
    const account = screen.getByLabelText('用户名 / 邮箱');
    fireEvent.change(account, { target: { value: 'admin' } });
    fireEvent.blur(account);
    expect(document.getElementById('accountMsg')?.textContent).toBe('');
    expect(account.getAttribute('aria-invalid')).toBeNull();
  });

  it('账号失焦校验：位数不足的纯数字同样放行，交由后端判定', () => {
    renderLogin();
    const account = screen.getByLabelText('用户名 / 邮箱');
    fireEvent.change(account, { target: { value: '138001380' } });
    fireEvent.blur(account);
    expect(document.getElementById('accountMsg')?.textContent).toBe('');
  });

  it('密码失焦校验：不设长度门槛（后端注册下限为 6 位）', () => {
    renderLogin();
    const password = screen.getByLabelText('密码');
    fireEvent.change(password, { target: { value: '1234567' } });
    fireEvent.blur(password);
    expect(document.getElementById('passwordMsg')?.textContent).toBe('');
  });

  it('登录失败时展示表单级横幅与剩余重试次数（原型 onLoginError）', async () => {
    vi.mocked(loginApi).mockRejectedValueOnce({ code: 401, message: '用户名或密码错误' });
    renderLogin();

    fireEvent.change(screen.getByLabelText('用户名 / 邮箱'), {
      target: { value: 'design@nova-ai.com' },
    });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /Login/ }));

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('用户名或密码错误，还可重试 4 次');
    // 字段级同时给出可操作提示
    expect(screen.getByText('密码错误，还可重试 4 次')).toBeTruthy();
  });

  it('连续失败达到上限时锁定账号并给出倒计时横幅（原型 MAX_ATTEMPTS / LOCK_SECONDS）', async () => {
    vi.mocked(loginApi).mockRejectedValue({ code: 401, message: '用户名或密码错误' });
    renderLogin();

    fireEvent.change(screen.getByLabelText('用户名 / 邮箱'), {
      target: { value: 'design@nova-ai.com' },
    });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } });

    const submit = () => screen.getByRole('button', { name: /Login/ }) as HTMLButtonElement;

    // 前 4 次失败：横幅给出剩余次数，按钮恢复可点
    for (let i = 0; i < 4; i += 1) {
      await waitFor(() => expect(submit().disabled).toBe(false));
      fireEvent.click(submit());
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('还可重试'),
      );
    }

    // 第 5 次失败：账号锁定
    await waitFor(() => expect(submit().disabled).toBe(false));
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/账号已锁定 15 分钟|账号锁定中/),
    );
    // 锁定期内主按钮置灰
    expect(submit().disabled).toBe(true);
  });

  it('切换到验证码登录 Tab 展示占位说明，可返回账号密码登录', () => {
    renderLogin();
    fireEvent.click(screen.getByRole('tab', { name: '验证码登录' }));
    expect(screen.getByText('验证码登录开发中')).toBeTruthy();
    expect(screen.queryByLabelText('密码')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '返回账号密码登录' }));
    expect(screen.getByRole('button', { name: /Login/ })).toBeTruthy();
  });

  it('切换登录方式会清理字段残留提示（原型 switchMode）', () => {
    renderLogin();
    const account = screen.getByLabelText('用户名 / 邮箱');
    // 空值失焦触发必填错误，作为「字段残留提示」
    fireEvent.blur(account);
    expect(document.getElementById('accountMsg')?.textContent).toBe('请输入用户名或邮箱');

    fireEvent.click(screen.getByRole('tab', { name: '验证码登录' }));
    fireEvent.click(screen.getByRole('tab', { name: '账号密码登录' }));
    expect(document.getElementById('accountMsg')?.textContent).toBe('');
  });

  it('Tab 具备完整的 tablist/tabpanel 语义与焦点可达性', () => {
    renderLogin();
    const pwdTab = screen.getByRole('tab', { name: '账号密码登录' });
    expect(pwdTab.getAttribute('aria-selected')).toBe('true');
    expect(pwdTab.getAttribute('aria-controls')).toBe('panel-pwd');
    expect(pwdTab.getAttribute('id')).toBe('tab-pwd');

    const panel = document.getElementById('panel-pwd');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('tab-pwd');
  });

  it('密码可见性可切换', () => {
    renderLogin();
    const pwd = screen.getByLabelText('密码') as HTMLInputElement;
    expect(pwd.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    expect(pwd.type).toBe('text');
    expect(screen.getByRole('button', { name: '隐藏密码' })).toBeTruthy();
  });

  it('必填字段带 * 标记且输入框与提示文案建立 aria 关联', () => {
    renderLogin();
    const account = screen.getByLabelText('用户名 / 邮箱');
    expect(account.getAttribute('aria-describedby')).toBe('accountMsg');
    expect(account.getAttribute('aria-required')).toBe('true');
    expect(document.getElementById('accountMsg')?.getAttribute('aria-live')).toBe('polite');

    const password = screen.getByLabelText('密码');
    expect(password.getAttribute('aria-describedby')).toBe('passwordMsg');
    expect(document.getElementById('passwordMsg')?.getAttribute('aria-live')).toBe('polite');
  });
});
