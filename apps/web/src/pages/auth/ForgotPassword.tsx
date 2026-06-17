/**
 * 忘记密码页 — 后端暂无忘记密码接口
 * 展示提示信息，后续对接时再实现
 */
import { Card, Button } from 'tdesign-react';
import { useNavigate } from 'react-router';
import styles from './auth.module.css';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.authPage}>
      <Card
        title="忘记密码"
        subtitle="重置密码功能暂未开放"
        style={{ width: 420 }}
        bordered
        className={styles.authCard}
      >
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🚧</div>
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>功能开发中</p>
          <p style={{ color: 'var(--td-text-color-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
            密码重置功能正在开发中。<br />
            如有需要，请联系管理员处理。
          </p>
          <Button theme="primary" size="large" onClick={() => navigate('/auth/login')}>
            返回登录
          </Button>
        </div>
      </Card>
    </div>
  );
}