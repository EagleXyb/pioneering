/**
 * 注册页 — 对齐原型 V1.3
 * 使用 TDesign Form 组件 + AuthLayout 品牌布局
 * 后端: POST /auth/register（backend-ts 已实现，返回 { token, refreshToken, user }）
 */
import { useState, useCallback, useMemo } from 'react';
import { useNavigate, NavLink } from 'react-router';
import { Form, Input, Button, MessagePlugin } from 'tdesign-react';
import type { SubmitContext } from 'tdesign-react/es/form/type';
import AuthLayout from './AuthLayout';
import { registerApi } from '../../api/auth-api';
import { useAuthStore } from '../../store/auth';
import styles from './auth.module.css';

const { FormItem } = Form;

/** 密码强度等级 */
type StrengthLevel = 0 | 1 | 2 | 3;

/** 计算密码强度 */
function calcPasswordStrength(password: string): StrengthLevel {
  let strength = 0;
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password)) strength++;
  return strength as StrengthLevel;
}

const strengthLabel: Record<StrengthLevel, string> = {
  0: '密码强度：弱',
  1: '密码强度：弱',
  2: '密码强度：中',
  3: '密码强度：强',
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const { authenticate } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const strength = useMemo(() => calcPasswordStrength(password), [password]);
  const passwordMatch = confirmPassword.length > 0 && password === confirmPassword;

  const handleSubmit = useCallback(
    async (ctx: SubmitContext) => {
      if (ctx.validateResult !== true) return;
      setError(null);
      setLoading(true);

      try {
        const { username, email, password: pwd } = ctx.fields as Record<string, string>;
        const res = await registerApi({ username, email, password: pwd });
        authenticate(res.user, res.token, res.refreshToken);
        MessagePlugin.success('注册成功');
        navigate('/chat', { replace: true });
      } catch (e: any) {
        // 处理后端响应状态码（状态码透传在 e.code，字段级校验错误在 e.details）
        const code = typeof e?.code === 'number' ? e.code : 0;
        let msg = '注册失败，请稍后重试';
        if (code === 409) {
          // 用户名或邮箱已被注册
          msg = e?.message || '用户名或邮箱已被注册';
        } else if (code === 400) {
          // 参数校验失败：优先展示字段级 details（如 body.email: Required）
          msg = e?.details || e?.message || '请求参数校验失败';
        } else if (code === 401) {
          msg = e?.message || '认证失败，请重新登录';
        } else if (code === 429) {
          msg = e?.message || '操作过于频繁，请稍后再试';
        } else if (code >= 500) {
          msg = e?.message || '服务器内部错误，请稍后重试';
        } else if (code === 0) {
          // 无法连接后端 / 网络异常（无状态码）
          msg = e?.message || '网络异常，请检查网络连接';
        } else {
          msg = e?.message || '注册失败，请稍后重试';
        }
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [authenticate, navigate],
  );

  // 表单验证规则
  const rules = {
    username: [
      { required: true, message: '请输入用户名', type: 'error' as const },
      { min: 2, message: '用户名至少 2 个字符', type: 'error' as const },
    ],
    email: [
      { required: true, message: '请输入邮箱地址', type: 'error' as const },
      { email: true, message: '请输入有效的邮箱地址', type: 'error' as const },
    ],
    password: [
      { required: true, message: '请设置密码', type: 'error' as const },
      { min: 8, message: '密码至少 8 位', type: 'error' as const },
    ],
    confirmPassword: [
      { required: true, message: '请再次输入密码', type: 'error' as const },
      {
        validator: (val: string) => val === password,
        message: '两次密码输入不一致',
        type: 'error' as const,
      },
    ],
  };

  return (
    <AuthLayout welcomeTitle="创建账号" welcomeSubtitle="注册后即可体验所有功能">
      {/* Tab 切换（登录/注册） */}
      <div className={styles.tabSwitch}>
        <NavLink to="/auth/login" className={({ isActive }) => isActive ? styles.tabBtnActive : styles.tabBtn}>
          登录
        </NavLink>
        <NavLink to="/auth/register" className={({ isActive }) => isActive ? styles.tabBtnActive : styles.tabBtn}>
          注册
        </NavLink>
      </div>

      {/* 注册表单 */}
      <div className={styles.formSection}>
        <Form
          rules={rules}
          onSubmit={handleSubmit}
          colon={false}
          labelAlign="top"
          style={{ width: '100%' }}
        >
          <FormItem label="用户名" name="username">
            <Input
              placeholder="请输入用户名"
              size="large"
              clearable
              style={{ height: 48 }}
            />
          </FormItem>

          <FormItem label="邮箱" name="email">
            <Input
              placeholder="请输入邮箱地址"
              size="large"
              clearable
              style={{ height: 48 }}
            />
          </FormItem>

          <FormItem label="密码" name="password">
            <Input
              type="password"
              placeholder="请设置密码（至少8位）"
              size="large"
              clearable
              style={{ height: 48 }}
              onChange={(val) => setPassword(val)}
            />
          </FormItem>

          {/* 密码强度指示器 */}
          {password.length > 0 && (
            <div className={styles.passwordStrength}>
              <div
                className={`${styles.strengthBar} ${
                  strength >= 1
                    ? strength >= 3
                      ? styles.strengthBarStrong
                      : strength >= 2
                        ? styles.strengthBarMedium
                        : styles.strengthBarWeak
                    : ''
                }`}
              />
              <div
                className={`${styles.strengthBar} ${
                  strength >= 2
                    ? strength >= 3
                      ? styles.strengthBarStrong
                      : styles.strengthBarMedium
                    : ''
                }`}
              />
              <div
                className={`${styles.strengthBar} ${
                  strength >= 3 ? styles.strengthBarStrong : ''
                }`}
              />
              <span
                className={`${styles.strengthText} ${
                  strength >= 3
                    ? styles.strengthTextStrong
                    : strength >= 2
                      ? styles.strengthTextMedium
                      : styles.strengthTextWeak
                }`}
              >
                {strengthLabel[strength]}
              </span>
            </div>
          )}

          <FormItem label="确认密码" name="confirmPassword">
            <Input
              type="password"
              placeholder="请再次输入密码"
              size="large"
              clearable
              style={{ height: 48 }}
              onChange={(val) => setConfirmPassword(val)}
            />
          </FormItem>

          {/* 密码匹配提示 */}
          {confirmPassword.length > 0 && (
            <div className={styles.confirmHint}>
              <div
                className={`${styles.hintDot} ${passwordMatch ? styles.hintDotMatch : ''}`}
              />
              <span
                className={`${styles.hintText} ${passwordMatch ? styles.hintTextMatch : ''}`}
              >
                {passwordMatch ? '两次密码输入一致' : '两次密码输入不一致'}
              </span>
            </div>
          )}

          {/* 错误提示 */}
          {error && <div className={styles.errorText}>{error}</div>}

          {/* 提交按钮 */}
          <Button
            type="submit"
            theme="primary"
            size="large"
            loading={loading}
            block
            style={{ height: 48, borderRadius: 8, fontSize: 16, fontWeight: 600, marginTop: 8 }}
          >
            {loading ? '注册中...' : '注 册'}
          </Button>
        </Form>

        {/* 底部链接 */}
        <div className={styles.footerLink}>
          <span className={styles.footerText}>已有账号？</span>
          <button className={styles.footerAction} onClick={() => navigate('/auth/login')}>
            立即登录
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}