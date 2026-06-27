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
            style={{ height: 40, borderRadius: 3, fontSize: 16, fontWeight: 600 }}
          >
            {isLoading ? '登录中...' : '登 录'}
          </Button>
        </Form>

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