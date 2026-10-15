/**
 * 登录页 — 严格对齐原型 docs/login-app（index.html + scripts/login.js）
 *
 * 覆盖原型「表单状态规范」板中的全部状态：
 *   必填校验 / 格式校验 / 错误提示 / 加载态 / 禁用态 / 成功态 / 失败态 / 锁定
 *
 * 可访问性（对应原型注释）：
 *   aria-invalid + aria-describedby 关联错误文案
 *   role="alert" 表单级错误；aria-live="polite" 字段级提示
 *   提交失败时焦点移至首个错误字段；加载中焦点移出表单区
 *   Enter 提交、Tab 顺序与视觉顺序一致
 *
 * 后端契约：POST /auth/login（username + password），由 useAuth → loginApi 承担。
 * 验证码登录面板本期为占位（见 apps/web/docs/登录页重构说明.md 的未实现需求清单）。
 */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../hooks/useAuth';
import {
  AlertIcon,
  CheckMark,
  EyeOffIcon,
  EyeOnIcon,
  FieldAccountIcon,
  FieldLockIcon,
  OtpIcon,
  SsoIcon,
  SubmitArrow,
  SubmitSpinner,
  TrustLock,
} from './authIcons';
import {
  FIELD_UNTOUCHED,
  LOCK_SECONDS,
  MAX_ATTEMPTS,
  checkAccount,
  checkPassword,
  fieldError,
  formatLock,
  type FieldResult,
} from './loginValidation';
import styles from './login.module.css';

type LoginMode = 'password' | 'code';
type SubmitState = 'idle' | 'loading' | 'success' | 'error';

/** 锁定解除提示（与原型 startLockTicker 一致，短暂展示后自动清除） */
const UNLOCK_NOTICE = '锁定已解除，请重新登录';

/** 组合字段容器的状态类（is-invalid / is-valid，对应原型 setFieldState） */
function fieldStateClass(state: FieldResult) {
  if (state.tone === 'err') return styles.fieldInvalid;
  if (state.tone === 'ok') return styles.fieldValid;
  return '';
}

/** 组合字段提示行的色调类 */
function msgStateClass(state: FieldResult) {
  if (state.tone === 'err') return styles.fieldMsgErr;
  if (state.tone === 'ok') return styles.fieldMsgOk;
  return '';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, clearError } = useAuth();

  const [mode, setMode] = useState<LoginMode>('password');

  // 账号密码面板字段
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [accountState, setAccountState] = useState<FieldResult>(FIELD_UNTOUCHED);
  const [passwordState, setPasswordState] = useState<FieldResult>(FIELD_UNTOUCHED);

  // 表单级错误横幅 + 按钮状态 + 失败计数/锁定
  const [formError, setFormError] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [lockLeft, setLockLeft] = useState(0);

  const accountRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);

  const isSubmitting = submitState === 'loading';
  const isLocked = lockedUntil > 0;

  /** 主按钮禁用态：仅在表单完全为空（初始态）或锁定期内置灰。
   *  注意（对应原型注释）：不能「一无效就禁用」，否则必填校验态永远无法通过点击触发，
   *  且键盘 Enter 的隐式提交也会失效（禁用按钮不响应隐式提交）。 */
  const pristine = account.trim() === '' && password === '';
  const submitDisabled = isSubmitting || isLocked || pristine;

  /* ------------------------------------------------ 锁定倒计时（原型 startLockTicker） */
  useEffect(() => {
    if (!lockedUntil) return;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const left = lockedUntil - Date.now();
      if (left <= 0) {
        // 锁定解除：重置计数并放行
        setAttempts(0);
        setLockedUntil(0);
        setLockLeft(0);
        setFormError(UNLOCK_NOTICE);
        return;
      }
      setLockLeft(left);
      setFormError(`账号锁定中，剩余 ${formatLock(left)}`);
    };

    // 首帧不立即执行：让「连续失败 N 次，账号已锁定 …」的提示先完整展示 1 秒，
    // 再由「账号锁定中，剩余 X 分 YY 秒」接管（原型 ticker 会立即覆盖前者）。
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [lockedUntil]);

  /* 锁定解除提示自动消失（原型 setTimeout(clearFormError, 2500)） */
  useEffect(() => {
    if (formError !== UNLOCK_NOTICE) return;
    const id = window.setTimeout(() => {
      setFormError((current) => (current === UNLOCK_NOTICE ? '' : current));
    }, 2500);
    return () => window.clearTimeout(id);
  }, [formError]);

  /* 失败态 450ms 后复位（原型 setTimeout(setButtonState('idle'), 450)） */
  useEffect(() => {
    if (submitState !== 'error') return;
    const id = window.setTimeout(() => {
      setSubmitState((current) => (current === 'error' ? 'idle' : current));
    }, 450);
    return () => window.clearTimeout(id);
  }, [submitState]);

  /* 切换登录方式后焦点跟随到新面板首个输入框（跳过首次渲染） */
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (mode === 'password') accountRef.current?.focus();
  }, [mode]);

  /** 当前面板全量校验；返回首个失败字段名，全部通过返回 null（原型 validateAll） */
  const validateAll = (): 'account' | 'password' | null => {
    setFormError('');
    const accountResult = checkAccount(account);
    const passwordResult = checkPassword(password);
    setAccountState(accountResult);
    setPasswordState(passwordResult);
    if (!accountResult.valid) return 'account';
    if (!passwordResult.valid) return 'password';
    return null;
  };

  /* ---------------------------------------------------- 登录失败（原型 onLoginError） */
  const onLoginError = (err: unknown) => {
    const message =
      (err as { message?: string } | null)?.message || '账号或密码错误，请重新输入';

    setSubmitState('error');
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);

    // 达到上限：锁定（原型 MAX_ATTEMPTS / LOCK_SECONDS）
    if (nextAttempts >= MAX_ATTEMPTS) {
      setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
      setFormError(
        `连续失败 ${MAX_ATTEMPTS} 次，账号已锁定 ${LOCK_SECONDS / 60} 分钟，可尝试二次验证解锁`,
      );
      passwordRef.current?.focus();
      return;
    }

    const left = MAX_ATTEMPTS - nextAttempts;
    setFormError(`${message}，还可重试 ${left} 次`);
    setPasswordState(fieldError(`密码错误，还可重试 ${left} 次`));
    // 聚焦并选中密码，便于直接重输
    const el = passwordRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  };

  /* ---------------------------------------------------------------- 提交（原型 handleSubmit） */
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting || submitState === 'success') return;

    if (isLocked) {
      setFormError(
        `失败次数过多，账号已锁定，请 ${formatLock(lockedUntil - Date.now())} 后重试`,
      );
      return;
    }

    // 全量校验：返回首个失败字段并聚焦（键盘用户可直接修正）
    const invalid = validateAll();
    if (invalid === 'account') {
      accountRef.current?.focus();
      return;
    }
    if (invalid === 'password') {
      passwordRef.current?.focus();
      return;
    }

    setFormError('');
    clearError();
    setSubmitState('loading');
    // 加载中焦点移出表单区
    submitRef.current?.focus();

    login({ username: account.trim(), password }, rememberMe)
      .then(() => {
        // 成功态为过渡态：跳转由 useAuth 的 navigate 承担
        setSubmitState('success');
        toast.success('登录成功');
      })
      .catch((err: unknown) => {
        onLoginError(err);
      });
  };

  /* ------------------------------------------------------------ 登录方式切换（原型 switchMode） */
  const switchMode = (next: LoginMode) => {
    if (isSubmitting) return;
    setMode(next);
    setFormError('');
    clearError();
    // 清理两侧残留状态（验证码面板本期为占位，字段状态无需重置）
    setAccountState(FIELD_UNTOUCHED);
    setPasswordState(FIELD_UNTOUCHED);
  };

  /* ---------------------------------------------------------------- 字段事件 */
  const onAccountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAccount(value);
    if (formError) setFormError('');
    if (accountState.tone === 'err') setAccountState(checkAccount(value));
  };

  const onAccountBlur = () => setAccountState(checkAccount(account));

  const onPasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPassword(value);
    if (formError) setFormError('');
    if (passwordState.tone === 'err') setPasswordState(checkPassword(value));
  };

  const onPasswordBlur = () => {
    // 空值失焦不报错（原型：if (password.value) validatePassword(true)）
    if (password) setPasswordState(checkPassword(password));
  };

  /* ---------------------------------------------------------------- 渲染 */
  const submitLabel =
    submitState === 'success' ? '验证通过，正在跳转…' : '登录\u00A0\u00A0Login';

  const submitBtnClass = [
    styles.submitBtn,
    submitState === 'loading' ? styles.submitBtnLoading : '',
    submitState === 'success' ? styles.submitBtnSuccess : '',
    submitState === 'error' ? styles.submitBtnError : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <AuthLayout
      welcomeTitle="登录工作台"
      welcomeSubtitle="Sign in to NOVA Workspace"
      showEnroll
    >
      {/* 登录方式切换 */}
      <div
        className={`${styles.tabs} ${mode === 'code' ? styles.tabsCode : ''}`}
        role="tablist"
        aria-label="登录方式"
      >
        {/* 滑动指示器：随当前 tab 平移 */}
        <span className={styles.tabIndicator} aria-hidden="true" />
        <button
          type="button"
          className={mode === 'password' ? styles.tabBtnActive : styles.tabBtn}
          role="tab"
          id="tab-pwd"
          aria-controls="panel-pwd"
          aria-selected={mode === 'password'}
          onClick={() => switchMode('password')}
        >
          账号密码登录
        </button>
        <button
          type="button"
          className={mode === 'code' ? styles.tabBtnActive : styles.tabBtn}
          role="tab"
          id="tab-otp"
          aria-controls="panel-otp"
          aria-selected={mode === 'code'}
          onClick={() => switchMode('code')}
        >
          验证码登录
        </button>
      </div>

      {/* 表单级错误横幅（服务端错误 / 锁定提示） */}
      {formError && (
        <div className={styles.formAlert} role="alert">
          <AlertIcon />
          <span>{formError}</span>
        </div>
      )}

      <form id="loginForm" noValidate autoComplete="on" onSubmit={handleSubmit}>
        {mode === 'password' ? (
          <div id="panel-pwd" role="tabpanel" aria-labelledby="tab-pwd">
            {/* 账号 */}
            <div
              className={[styles.field, styles.fieldAccount, fieldStateClass(accountState)]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.fieldLabelRow}>
                <label className={styles.fieldLabel} htmlFor="account">
                  用户名 / 邮箱
                </label>
                <span className={styles.fieldRequired} aria-hidden="true">
                  *
                </span>
              </div>
              <div className={styles.fieldBox}>
                <FieldAccountIcon className={styles.fieldIcon} />
                <input
                  ref={accountRef}
                  className={styles.fieldInput}
                  type="text"
                  id="account"
                  name="account"
                  placeholder="用户名或邮箱"
                  autoComplete="username"
                  aria-describedby="accountMsg"
                  aria-required="true"
                  aria-invalid={accountState.tone === 'err' || undefined}
                  disabled={isSubmitting}
                  value={account}
                  onChange={onAccountChange}
                  onBlur={onAccountBlur}
                />
              </div>
              <p
                className={[styles.fieldMsg, msgStateClass(accountState)]
                  .filter(Boolean)
                  .join(' ')}
                id="accountMsg"
                aria-live="polite"
              >
                {accountState.message}
              </p>
            </div>

            {/* 密码 */}
            <div
              className={[styles.field, styles.fieldPassword, fieldStateClass(passwordState)]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.fieldLabelRow}>
                <label className={styles.fieldLabel} htmlFor="password">
                  密码
                </label>
                <span className={styles.fieldRequired} aria-hidden="true">
                  *
                </span>
              </div>
              <div className={`${styles.fieldBox} ${styles.fieldBoxHasBtn}`}>
                <FieldLockIcon className={styles.fieldIcon} />
                <input
                  ref={passwordRef}
                  className={styles.fieldInput}
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  aria-describedby="passwordMsg"
                  aria-required="true"
                  aria-invalid={passwordState.tone === 'err' || undefined}
                  disabled={isSubmitting}
                  value={password}
                  onChange={onPasswordChange}
                  onBlur={onPasswordBlur}
                />
                <button
                  type="button"
                  className={styles.fieldToggle}
                  id="pwdToggle"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  aria-controls="password"
                  disabled={isSubmitting}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeOnIcon />}
                </button>
              </div>
              <p
                className={[styles.fieldMsg, msgStateClass(passwordState)]
                  .filter(Boolean)
                  .join(' ')}
                id="passwordMsg"
                aria-live="polite"
              >
                {passwordState.message}
              </p>
            </div>

            {/* 记住登录 / 忘记密码 */}
            <div className={styles.meta}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  id="remember"
                  name="remember"
                  className={styles.checkInput}
                  checked={rememberMe}
                  disabled={isSubmitting}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span className={styles.checkBox} aria-hidden="true">
                  <CheckMark />
                </span>
                <span>记住登录状态</span>
              </label>
              <button
                type="button"
                className={styles.link}
                onClick={() => navigate('/auth/forgot-password')}
              >
                忘记密码？
              </button>
            </div>
          </div>
        ) : (
          <div
            id="panel-otp"
            role="tabpanel"
            aria-labelledby="tab-otp"
            className={styles.otpPanel}
          >
            <div className={styles.comingSoon}>
              <div className={styles.comingSoonIcon}>🚧</div>
              <p className={styles.comingSoonTitle}>验证码登录开发中</p>
              <p className={styles.comingSoonDesc}>
                短信 / 邮箱验证码登录正在开发中，
                <br />
                请先使用账号密码登录。
              </p>
              <button
                type="button"
                className={styles.comingSoonBtn}
                onClick={() => switchMode('password')}
              >
                返回账号密码登录
              </button>
            </div>
          </div>
        )}

        {/* 主登录按钮 */}
        <button
          ref={submitRef}
          type="submit"
          className={submitBtnClass}
          id="submitBtn"
          disabled={submitDisabled}
          aria-busy={isSubmitting}
        >
          <SubmitSpinner className={`${styles.submitBtnSpinner} ${styles.spinner}`} />
          <span className={styles.submitBtnLabel}>{submitLabel}</span>
          <SubmitArrow className={styles.submitBtnArrow} />
        </button>
      </form>

      {/* 辅助登录方式 */}
      <div className={styles.altRow}>
        <span className={styles.altRowLine} aria-hidden="true" />
        <span className={styles.altRowText}>或使用其他方式</span>
        <span className={styles.altRowLine} aria-hidden="true" />
      </div>

      <div className={styles.altBtns}>
        <button
          type="button"
          className={styles.btnAlt}
          onClick={() => toast.info('企业 SSO 即将支持')}
        >
          <SsoIcon />
          企业SSO
        </button>
        <button type="button" className={styles.btnAlt} onClick={() => switchMode('code')}>
          <OtpIcon />
          验证码登录
        </button>
      </div>

      {/* 安全加密提示 */}
      <p className={styles.trust}>
        <TrustLock />
        全链路 TLS 1.3 加密传输，凭证不落盘
      </p>
    </AuthLayout>
  );
}
