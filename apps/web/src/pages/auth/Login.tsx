/**
 * 登录页 — 对齐原型 V1.3
 * 原生受控表单 + shadcn 基座 + AuthLayout 品牌布局
 * 后端: POST /auth/login (username + password)
 *
 * 校验规则：
 * - username 必填
 * - password 必填
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import styles from './auth.module.css';

type FieldName = 'username' | 'password';
type Errors = Partial<Record<FieldName, string>>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    username: false,
    password: false,
  });
  const [submitted, setSubmitted] = useState(false);

  /** 校验逻辑 */
  const validate = (): Errors => {
    const next: Errors = {};
    if (!username.trim()) next.username = '请输入用户名或邮箱';
    if (!password) next.password = '请输入密码';
    return next;
  };

  const errors = validate();
  const showError = (field: FieldName) =>
    (submitted || touched[field]) && errors[field];

  const markTouched = (field: FieldName) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) return;

    clearError();
    login({ username: username.trim(), password }, rememberMe)
      .then(() => {
        toast.success('登录成功');
      })
      .catch(() => {
        // 错误由 useAuth hook 统一处理
      });
  };

  return (
    <AuthLayout welcomeTitle="欢迎回来" welcomeSubtitle="请登录您的账号以继续">
      {/* Tab 切换（登录/注册） */}
      <div className={styles.tabSwitch}>
        <NavLink
          to="/auth/login"
          className={({ isActive }) =>
            isActive ? styles.tabBtnActive : styles.tabBtn
          }
        >
          登录
        </NavLink>
        <NavLink
          to="/auth/register"
          className={({ isActive }) =>
            isActive ? styles.tabBtnActive : styles.tabBtn
          }
        >
          注册
        </NavLink>
      </div>

      {/* 登录表单 */}
      <div className={styles.formSection}>
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="login-username">
              邮箱 / 用户名
            </label>
            <Input
              id="login-username"
              name="username"
              autoComplete="username"
              placeholder="请输入邮箱或用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => markTouched('username')}
              aria-invalid={!!showError('username')}
              aria-describedby={
                showError('username') ? 'login-username-error' : undefined
              }
              className={`${styles.formInput}${
                showError('username') ? ` ${styles.formInputError}` : ''
              }`}
            />
            {showError('username') && (
              <div className={styles.fieldError} id="login-username-error">
                {errors.username}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="login-password">
              密码
            </label>
            <div className={styles.inputWrap}>
              <Input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => markTouched('password')}
                aria-invalid={!!showError('password')}
                aria-describedby={
                  showError('password') ? 'login-password-error' : undefined
                }
                className={`${styles.formInput} ${styles.inputWithAction}${
                  showError('password') ? ` ${styles.formInputError}` : ''
                }`}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {showError('password') && (
              <div className={styles.fieldError} id="login-password-error">
                {errors.password}
              </div>
            )}
          </div>

          {/* 记住我 + 忘记密码 */}
          <div className={styles.rememberRow}>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
              />
              <span className={styles.footerText}>记住我</span>
            </label>
            <button
              type="button"
              className={styles.footerAction}
              onClick={() => navigate('/auth/forgot-password')}
            >
              忘记密码？
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className={styles.errorText} role="alert">
              {error}
            </div>
          )}

          {/* 提交按钮 */}
          <Button
            type="submit"
            disabled={isLoading}
            aria-busy={isLoading}
            className={`w-full ${styles.submitButton}`}
          >
            {isLoading ? (
              <>
                <Spinner className="h-4 w-4" />
                登录中...
              </>
            ) : (
              '登 录'
            )}
          </Button>
        </form>

        {/* 底部链接 */}
        <div className={styles.footerLink}>
          <span className={styles.footerText}>还没有账号？</span>
          <button
            className={styles.footerAction}
            onClick={() => navigate('/auth/register')}
          >
            立即注册
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}
