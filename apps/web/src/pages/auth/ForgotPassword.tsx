/**
 * 忘记密码页 — 对齐原型 V1.3
 * 后端暂无忘记密码接口，展示提示信息
 */
import { useNavigate } from 'react-router';
import { Button } from 'tdesign-react';
import AuthLayout from './AuthLayout';
import styles from './auth.module.css';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout welcomeTitle="忘记密码" welcomeSubtitle="请输入您的注册邮箱，我们将发送重置链接">
      <div className={styles.formSection}>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🚧</div>
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: '#1E293B' }}>
            功能开发中
          </p>
          <p
            style={{
              color: '#64748B',
              marginBottom: 24,
              lineHeight: 1.6,
              fontSize: 14,
            }}
          >
            密码重置功能正在开发中。
            <br />
            如有需要，请联系管理员处理。
          </p>
          <Button
            theme="primary"
            size="large"
            block
            onClick={() => navigate('/auth/login')}
            style={{ height: 48, borderRadius: 8, fontSize: 16, fontWeight: 600 }}
          >
            返回登录
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}