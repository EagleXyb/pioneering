/**
 * 登录页 — 对齐后端 POST /auth/login
 * 后端暂无注册接口，注册按钮引导用户联系管理员或提示待开放
 */
import { useNavigate } from 'react-router';
import { Card, MessagePlugin } from 'tdesign-react';
import LoginForm from '../../components/auth/LoginForm';
import OAuthButtons from '../../components/auth/OAuthButtons';
import styles from './auth.module.css';

export default function LoginPage() {
  const navigate = useNavigate();

  const handleRegister = () => {
    MessagePlugin.info('注册功能待开放，请联系管理员开通账号');
  };

  return (
    <div className={styles.authPage}>
      <Card
        title="登录"
        subtitle="欢迎回来，请登录您的账号"
        style={{ width: 420 }}
        bordered
        className={styles.authCard}
      >
        <LoginForm
          onRegister={handleRegister}
          onForgotPassword={() => navigate('/auth/forgot-password')}
        />
        <OAuthButtons
          onGitHub={() => MessagePlugin.info('GitHub 登录待对接')}
          onWeChat={() => MessagePlugin.info('微信登录待对接')}
          onQQ={() => MessagePlugin.info('QQ 登录待对接')}
        />
      </Card>
    </div>
  );
}