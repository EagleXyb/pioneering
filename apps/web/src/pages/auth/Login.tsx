/**
 * 登录页 — 对齐原型 V1.3
 * 使用 TDesign Form 组件 + AuthLayout 品牌布局
 * 后端: POST /auth/login (username + password)
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Form, Input, Button, Checkbox, MessagePlugin } from 'tdesign-react';
import type { SubmitContext } from 'tdesign-react/es/form/type';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../hooks/useAuth';
import styles from './auth.module.css';

const { FormItem } = Form;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuth();
  const [rememberMe, setRememberMe] = useState(true);

  const handleSubmit = useCallback(
    (ctx: SubmitContext) => {
      if (ctx.validateResult !== true) return;
      clearError();
      const { username, password } = ctx.fields as Record<string, string>;
      login({ username, password })
        .then(() => {
          MessagePlugin.success('登录成功');
        })
        .catch(() => {
          // 错误由 useAuth hook 统一处理
        });
    },
    [login, clearError],
  );

  // 表单验证规则
  const rules = {
    username: [
      { required: true, message: '请输入用户名或邮箱', type: 'error' as const },
    ],
    password: [
      { required: true, message: '请输入密码', type: 'error' as const },
    ],
  };

  return (
    <AuthLayout welcomeTitle="欢迎回来" welcomeSubtitle="请登录您的账号以继续">
      {/* Tab 切换（登录/注册） */}
      <div className={styles.tabSwitch}>
        <button className={styles.tabBtnActive}>登录</button>
        <button className={styles.tabBtn} onClick={() => navigate('/auth/register')}>
          注册
        </button>
      </div>

      {/* 登录表单 */}
      <div className={styles.formSection}>
        <Form
          rules={rules}
          onSubmit={handleSubmit}
          colon={false}
          labelAlign="top"
          style={{ width: '100%' }}
        >
          <FormItem label="邮箱 / 用户名" name="username">
            <Input
              placeholder="请输入邮箱或用户名"
              size="large"
              clearable
              style={{ height: 48 }}
            />
          </FormItem>

          <FormItem label="密码" name="password">
            <Input
              type="password"
              placeholder="请输入密码"
              size="large"
              clearable
              style={{ height: 48 }}
            />
          </FormItem>

          {/* 记住我 + 忘记密码 */}
          <div className={styles.rememberRow}>
            <Checkbox checked={rememberMe} onChange={setRememberMe}>
              <span className={styles.footerText}>记住我</span>
            </Checkbox>
            <button
              type="button"
              className={styles.footerAction}
              onClick={() => navigate('/auth/forgot-password')}
            >
              忘记密码？
            </button>
          </div>

          {/* 错误提示 */}
          {error && <div className={styles.errorText}>{error}</div>}

          {/* 提交按钮 */}
          <Button
            type="submit"
            theme="primary"
            size="large"
            loading={isLoading}
            block
            style={{ height: 48, borderRadius: 8, fontSize: 16, fontWeight: 600 }}
          >
            {isLoading ? '登录中...' : '登 录'}
          </Button>
        </Form>

        {/* 分割线 */}
        <div className={styles.divider}>
          <div className={styles.dividerLine} />
          <span className={styles.dividerText}>或使用其他方式登录</span>
          <div className={styles.dividerLine} />
        </div>

        {/* 微信登录 */}
        <div className={styles.socialLogin}>
          <button
            className={styles.wechatBtn}
            title="微信登录"
            onClick={() => MessagePlugin.info('微信登录功能即将上线')}
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
              <path
                d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.007-.269-.02-.407-.032zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"
                fill="white"
              />
            </svg>
          </button>
        </div>

        {/* 底部链接 */}
        <div className={styles.footerLink}>
          <span className={styles.footerText}>还没有账号？</span>
          <button className={styles.footerAction} onClick={() => navigate('/auth/register')}>
            立即注册
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}