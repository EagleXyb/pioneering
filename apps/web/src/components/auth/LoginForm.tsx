/**
 * 可复用登录表单 — TDesign
 * 对齐后端 LoginRequestDto：使用 username（而非 email）登录
 */
import { useState } from 'react';
import { Input, Button, MessagePlugin } from 'tdesign-react';
import { useAuth } from '../../hooks/useAuth';

interface LoginFormProps {
  onRegister?: () => void;
  onForgotPassword?: () => void;
}

export default function LoginForm({ onRegister, onForgotPassword }: LoginFormProps) {
  const { login, isLoading, error, clearError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    login({ username, password })
      .then(() => MessagePlugin.success('登录成功'))
      .catch(() => {});
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <Input
          value={username}
          onChange={(val) => setUsername(val)}
          placeholder="请输入用户名"
          size="large"
          clearable
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Input
          value={password}
          onChange={(val) => setPassword(val)}
          type="password"
          placeholder="请输入密码"
          size="large"
          clearable
        />
      </div>

      {error && (
        <div style={{ color: 'var(--td-error-color)', fontSize: 14, marginBottom: 16 }}>{error}</div>
      )}

      <Button
        type="submit"
        theme="primary"
        size="large"
        loading={isLoading}
        block
      >
        {isLoading ? '登录中...' : '登录'}
      </Button>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        {onForgotPassword && (
          <Button variant="text" theme="primary" onClick={onForgotPassword}>
            忘记密码？
          </Button>
        )}
        {onRegister && (
          <Button variant="text" theme="primary" onClick={onRegister}>
            立即注册
          </Button>
        )}
      </div>
    </form>
  );
}