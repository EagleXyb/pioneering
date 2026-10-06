/**
 * 忘记密码页 — 对齐原型 V1.3
 * 后端暂无忘记密码接口，展示提示信息
 */
import { useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { Button } from '@/components/ui/button';
import styles from './auth.module.css';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout
      welcomeTitle="忘记密码"
      welcomeSubtitle="请输入您的注册邮箱，我们将发送重置链接"
    >
      <div className={styles.formSection}>
        <div className={styles.comingSoon}>
          <div className={styles.comingSoonIcon}>🚧</div>
          <p className={styles.comingSoonTitle}>功能开发中</p>
          <p className={styles.comingSoonDesc}>
            密码重置功能正在开发中。
            <br />
            如有需要，请联系管理员处理。
          </p>
          <Button
            onClick={() => navigate('/auth/login')}
            className={`w-full ${styles.submitButton}`}
          >
            返回登录
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
