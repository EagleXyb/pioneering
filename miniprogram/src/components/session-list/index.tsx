import { View, Text } from '@tarojs/components';
import { type SessionItem } from '@/store';
import styles from './index.module.scss';

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

interface SessionListItemProps {
  session: SessionItem;
  active?: boolean;
  showDelete?: boolean;
  onClick: (id: string) => void;
  onDelete?: (id: string) => void;
}

function SessionListItem({
  session,
  active,
  showDelete,
  onClick,
  onDelete,
}: SessionListItemProps) {
  return (
    <View className={`${styles.item} ${active ? styles.itemActive : ''}`}>
      <View className={styles.content} onClick={() => onClick(session.id)}>
        <View className={styles.info}>
          <Text className={styles.title}>{session.title}</Text>
          <Text className={styles.preview}>{session.preview}</Text>
          {showDelete && (
            <Text className={styles.time}>
              {formatTime(session.updatedAt)}
            </Text>
          )}
        </View>
        {showDelete && <Text className={styles.arrow}>›</Text>}
      </View>
      {showDelete && onDelete && (
        <View
          className={styles.deleteBtn}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(session.id);
          }}
        >
          <Text className={styles.deleteText}>删除</Text>
        </View>
      )}
    </View>
  );
}

interface SessionListProps {
  sessions: SessionItem[];
  activeId?: string;
  variant?: 'full' | 'compact';
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

export default function SessionList({
  sessions,
  activeId,
  variant = 'full',
  onSelect,
  onDelete,
}: SessionListProps) {
  return (
    <>
      {sessions.map((session) => (
        <SessionListItem
          key={session.id}
          session={session}
          active={session.id === activeId}
          showDelete={variant === 'full'}
          onClick={onSelect}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}
