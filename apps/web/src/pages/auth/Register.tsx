/**
 * 注册页 — 对齐原型 V1.3
 * 原生受控表单（阶段 3 去除 TDesign Form）+ shadcn 基座 + AuthLayout 品牌布局
 * 后端: POST /auth/register（backend-ts 已实现，返回 { token, refreshToken, user }）
 *
 * 校验规则从 TDesign Form rule 平移：
 * - username 必填、至少 2 字符
 * - email 必填、邮箱格式
 * - password 必填、至少 8 位
 * - confirmPassword 必填、与 password 一致
 */
import { useState, useMemo, type FormEvent, type ChangeEvent } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { registerApi } from '../../api/auth-api';
import { useAuthStore } from '../../store/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import styles from './auth.module.css';

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

// 与 TDesign `email: true` 内置规则一致的简单邮箱校验
const EMAIL_RE = /^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/;

type FieldName = 'username' | 'email' | 'password' | 'confirmPassword';
type Errors = Partial<Record<FieldName, string>>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { authenticate } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    username: false,
    email: false,
    password: false,
    confirmPassword: false,
  });
  const [submitted, setSubmitted] = useState(false);

  const strength = useMemo(
    () => calcPasswordStrength(form.password),
    [form.password],
  );
  const passwordMatch =
    form.confirmPassword.length > 0 && form.password === form.confirmPassword;

  const setField =
    (field: FieldName) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const markTouched = (field: FieldName) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  /** 校验逻辑（与原 TDesign rules 一一对应） */
  const validate = (): Errors => {
    const next: Errors = {};
    if (!form.username.trim()) {
      next.username = '请输入用户名';
    } else if (form.username.trim().length < 2) {
      next.username = '用户名至少 2 个字符';
    }
    if (!form.email.trim()) {
      next.email = '请输入邮箱地址';
    } else if (!EMAIL_RE.test(form.email.trim())) {
      next.email = '请输入有效的邮箱地址';
    }
    if (!form.password) {
      next.password = '请设置密码';
    } else if (form.password.length < 8) {
      next.password = '密码至少 8 位';
    }
    if (!form.confirmPassword) {
      next.confirmPassword = '请再次输入密码';
    } else if (form.confirmPassword !== form.password) {
      next.confirmPassword = '两次密码输入不一致';
    }
    return next;
  };

  const errors = validate();
  const showError = (field: FieldName) =>
    (submitted || touched[field]) && errors[field];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) return;

    setError(null);
    setLoading(true);

    try {
      const res = await registerApi({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      authenticate(res.user, res.token, res.refreshToken);
      toast.success('注册成功');
      navigate('/chat', { replace: true });
    } catch (err: unknown) {
      // 处理后端响应状态码（状态码透传在 e.code，字段级校验错误在 e.details）
      const e = err as {
        code?: number;
        message?: string;
        details?: string;
      };
      const code = typeof e?.code === 'number' ? e.code : 0;
      let msg = '注册失败，请稍后重试';
      if (code === 409) {
        msg = e?.message || '用户名或邮箱已被注册';
      } else if (code === 400) {
        msg = e?.details || e?.message || '请求参数校验失败';
      } else if (code === 401) {
        msg = e?.message || '认证失败，请重新登录';
      } else if (code === 429) {
        msg = e?.message || '操作过于频繁，请稍后再试';
      } else if (code >= 500) {
        msg = e?.message || '服务器内部错误，请稍后重试';
      } else if (code === 0) {
        msg = e?.message || '网络异常，请检查网络连接';
      } else {
        msg = e?.message || '注册失败，请稍后重试';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout welcomeTitle="创建账号" welcomeSubtitle="注册后即可体验所有功能">
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

      {/* 注册表单 */}
      <div className={styles.formSection}>
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="reg-username">
              用户名
            </label>
            <Input
              id="reg-username"
              name="username"
              autoComplete="username"
              placeholder="请输入用户名"
              value={form.username}
              onChange={setField('username')}
              onBlur={() => markTouched('username')}
              aria-invalid={!!showError('username')}
              aria-describedby={
                showError('username') ? 'reg-username-error' : undefined
              }
              className={`${styles.formInput}${
                showError('username') ? ` ${styles.formInputError}` : ''
              }`}
            />
            {showError('username') && (
              <div className={styles.fieldError} id="reg-username-error">
                {errors.username}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="reg-email">
              邮箱
            </label>
            <Input
              id="reg-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="请输入邮箱地址"
              value={form.email}
              onChange={setField('email')}
              onBlur={() => markTouched('email')}
              aria-invalid={!!showError('email')}
              aria-describedby={
                showError('email') ? 'reg-email-error' : undefined
              }
              className={`${styles.formInput}${
                showError('email') ? ` ${styles.formInputError}` : ''
              }`}
            />
            {showError('email') && (
              <div className={styles.fieldError} id="reg-email-error">
                {errors.email}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="reg-password">
              密码
            </label>
            <div className={styles.inputWrap}>
              <Input
                id="reg-password"
                name="new-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="请设置密码（至少8位）"
                value={form.password}
                onChange={setField('password')}
                onBlur={() => markTouched('password')}
                aria-invalid={!!showError('password')}
                aria-describedby={
                  showError('password') ? 'reg-password-error' : undefined
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
              <div className={styles.fieldError} id="reg-password-error">
                {errors.password}
              </div>
            )}
          </div>

          {/* 密码强度指示器 */}
          {form.password.length > 0 && (
            <div className={styles.passwordStrength} aria-hidden="true">
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

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="reg-confirm">
              确认密码
            </label>
            <div className={styles.inputWrap}>
              <Input
                id="reg-confirm"
                name="confirm-new-password"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="请再次输入密码"
                value={form.confirmPassword}
                onChange={setField('confirmPassword')}
                onBlur={() => markTouched('confirmPassword')}
                aria-invalid={!!showError('confirmPassword')}
                aria-describedby={
                  showError('confirmPassword')
                    ? 'reg-confirm-error'
                    : undefined
                }
                className={`${styles.formInput} ${styles.inputWithAction}${
                  showError('confirmPassword')
                    ? ` ${styles.formInputError}`
                    : ''
                }`}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? '隐藏密码' : '显示密码'}
                aria-pressed={showConfirm}
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {showError('confirmPassword') && (
              <div className={styles.fieldError} id="reg-confirm-error">
                {errors.confirmPassword}
              </div>
            )}
          </div>

          {/* 密码匹配提示 */}
          {form.confirmPassword.length > 0 && !showError('confirmPassword') && (
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
          {error && (
            <div className={styles.errorText} role="alert">
              {error}
            </div>
          )}

          {/* 提交按钮 */}
          <Button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className={`w-full ${styles.submitButton}`}
          >
            {loading ? (
              <>
                <Spinner className="h-4 w-4" />
                注册中...
              </>
            ) : (
              '注 册'
            )}
          </Button>
        </form>

        {/* 底部链接 */}
        <div className={styles.footerLink}>
          <span className={styles.footerText}>已有账号？</span>
          <button
            className={styles.footerAction}
            onClick={() => navigate('/auth/login')}
          >
            立即登录
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}
