/**
 * 注册页 — 后端暂无注册接口
 * 展示注册已关闭的提示信息
 */
import { Card, Button } from 'tdesign-react';
import { useNavigate } from 'react-router';
import styles from './auth.module.css';

export default function RegisterPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.authPage}>
      <Card
        title="注册"
        subtitle="创建账号，开始使用 Pioneering"
        style={{ width: 420 }}
        bordered
        className={styles.authCard}
      >
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🚧</div>
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>注册功能暂未开放</p>
          <p style={{ color: 'var(--td-text-color-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
            当前仅支持通过已有账号登录。<br />
            如需开通账号，请联系管理员。
          </p>
          <Button theme="primary" size="large" onClick={() => navigate('/auth/login')}>
            返回登录
          </Button>
        </div>
      </Card>
    </div>
  );
}