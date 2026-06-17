/**
 * OAuth 第三方登录按钮组
 */
import { Button, Divider, Space } from 'tdesign-react';
import {
  LogoGithubIcon,
  LogoWechatIcon,
  LogoQqIcon,
} from 'tdesign-icons-react';

interface OAuthButtonsProps {
  onGitHub?: () => void;
  onWeChat?: () => void;
  onQQ?: () => void;
}

export default function OAuthButtons({ onGitHub, onWeChat, onQQ }: OAuthButtonsProps) {
  return (
    <div>
      <Divider style={{ color: 'var(--td-text-color-secondary)', margin: '24px 0' }}>
        其他登录方式
      </Divider>
      <Space size={16} style={{ display: 'flex', justifyContent: 'center' }}>
        {onGitHub && (
          <Button
            variant="outline"
            shape="circle"
            size="large"
            onClick={onGitHub}
            title="GitHub 登录"
          >
            <LogoGithubIcon />
          </Button>
        )}
        {onWeChat && (
          <Button
            variant="outline"
            shape="circle"
            size="large"
            onClick={onWeChat}
            title="微信登录"
          >
            <LogoWechatIcon />
          </Button>
        )}
        {onQQ && (
          <Button
            variant="outline"
            shape="circle"
            size="large"
            onClick={onQQ}
            title="QQ 登录"
          >
            <LogoQqIcon />
          </Button>
        )}
      </Space>
    </div>
  );
}