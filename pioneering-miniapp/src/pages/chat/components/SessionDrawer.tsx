import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '@/store';
import { formatTime } from '@/utils';
import styles from './SessionDrawer.module.scss';

interface SessionDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export default function SessionDrawer({ visible, onClose }: SessionDrawerProps) {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setCurrentSessionId = useAppStore((s) => s.setCurrentSessionId);
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);

  const handleSwitch = (id: string) => {
    setCurrentSessionId(id);
    onClose();
    Taro.redirectTo({ url: `/pages/chat/index?sessionId=${id}` });
  };

  const handleNew = () => {
    const newSession = {
      id: `session_${Date.now()}`,
      title: '新的探索',
      preview: '开始一段全新的对话...',
      mode: 'script' as const,
      phase: 0,
      messageCount: 0,
      updatedAt: Date.now(),
    };
    addSession(newSession);
    setCurrentSessionId(newSession.id);
    onClose();
    Taro.redirectTo({ url: `/pages/chat/index?sessionId=${newSession.id}` });
  };

  const handleDelete = (id: string) => {
    removeSession(id);
  };

  return (
    <t-drawer
      visible={visible}
      placement="left"
      closeOnOverlayClick
      onClose={onClose}
      onOverlayClick={onClose}
    >
      <View className={styles.drawer}>
        <View className={styles.header}>
          <Text className={styles.title}>对话列表</Text>
          <t-button
            theme="primary"
            size="small"
            icon="add"
            onClick={handleNew}
          >
            新对话
          </t-button>
        </View>

        <View className={styles.list}>
          {sessions.length === 0 ? (
            <t-empty icon="chat" description="暂无对话" />
          ) : (
            sessions.map((session) => (
              <t-swipe-cell
                key={session.id}
                right={[{ text: '删除', className: 'btn-delete' }]}
                onClick={(e: any) => {
                  // TDesign swipe-cell 的 click 事件参数是 action 对象
                  const action = e.detail;
                  if (action?.text === '删除') handleDelete(session.id);
                }}
              >
                <View
                  className={`${styles.item} ${session.id === currentSessionId ? styles.active : ''}`}
                  onClick={() => handleSwitch(session.id)}
                >
                  <View className={styles.itemInfo}>
                    <Text className={styles.itemTitle}>{session.title}</Text>
                    <Text className={styles.itemPreview}>{session.preview}</Text>
                  </View>
                  <View className={styles.itemMeta}>
                    <Text className={styles.itemTime}>
                      {formatTime(session.updatedAt)}
                    </Text>
                    {session.mode === 'ai' && (
                      <t-tag size="small" theme="primary" variant="light">
                        AI
                      </t-tag>
                    )}
                  </View>
                </View>
              </t-swipe-cell>
            ))
          )}
        </View>
      </View>
    </t-drawer>
  );
}
