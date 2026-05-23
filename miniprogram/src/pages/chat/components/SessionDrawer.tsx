import { View } from '@tarojs/components';
import { type SessionItem } from '@/store';
import EmptyState from '@/components/empty-state';
import SessionList from '@/components/session-list';
import styles from './SessionDrawer.module.scss';

interface SessionDrawerProps {
  visible: boolean;
  sessions: SessionItem[];
  activeId: string;
  onVisibleChange: (e: any) => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewChat: () => void;
}

export default function SessionDrawer({
  visible,
  sessions,
  activeId,
  onVisibleChange,
  onSelectSession,
  onDeleteSession,
  onNewChat,
}: SessionDrawerProps) {
  return (
    <t-drawer
      visible={visible}
      placement="left"
      showOverlay
      closeOnOverlayClick
      title="会话列表"
      onVisibleChange={onVisibleChange}
    >
      <View className={styles.drawerContent}>
        {sessions.length === 0 ? (
          <EmptyState text="暂无会话" />
        ) : (
          <SessionList
            sessions={sessions}
            activeId={activeId}
            variant="full"
            onSelect={onSelectSession}
            onDelete={onDeleteSession}
          />
        )}
        <View className={styles.drawerBottom}>
          <t-button theme="primary" size="medium" block onClick={onNewChat}>
            + 新建对话
          </t-button>
        </View>
      </View>
    </t-drawer>
  );
}
