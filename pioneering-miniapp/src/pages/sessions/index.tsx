import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, type SessionItem } from '@/store';
import './index.module.scss';

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function SessionsPage() {
  const sessions = useAppStore((s) => s.sessions);
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setCurrentSessionId = useAppStore((s) => s.setCurrentSessionId);

  const handleSessionClick = (id: string) => {
    setCurrentSessionId(id);
    Taro.navigateTo({ url: `/pages/chat/index?sessionId=${id}` });
  };

  const handleNewChat = () => {
    const newSession: SessionItem = {
      id: `session_${Date.now()}`,
      title: '新的探索',
      preview: '开始一段全新的对话...',
      mode: 'script',
      phase: 0,
      messageCount: 0,
      updatedAt: Date.now(),
    };
    addSession(newSession);
    setCurrentSessionId(newSession.id);
    Taro.navigateTo({ url: `/pages/chat/index?sessionId=${newSession.id}` });
  };

  const handleDelete = (id: string) => {
    removeSession(id);
  };

  return (
    <View className="page">
      <t-navbar title="创路 Agent" className="navbar" />

      <View className="body">
        {sessions.length === 0 ? (
          <View className="emptyWrap">
            <t-empty icon="chat" description="还没有对话，开始新的探索吧" />
          </View>
        ) : (
          sessions.map((session) => (
            <View key={session.id} className="sessionItem">
              <t-swipe-cell
                right={[{ text: '删除', className: 'btn-delete' }]}
                onClick={(e: any) => {
                  if (e.detail.index === 0) handleDelete(session.id);
                }}
              >
                <View
                  className="sessionContent"
                  onClick={() => handleSessionClick(session.id)}
                >
                  <View className="sessionInfo">
                    <Text className="sessionTitle">{session.title}</Text>
                    <Text className="sessionPreview">{session.preview}</Text>
                    <View className="sessionMeta">
                      <Text className="sessionTime">
                        {formatTime(session.updatedAt)}
                      </Text>
                      {session.mode === 'ai' && (
                        <t-tag size="small" theme="primary" variant="light">
                          AI
                        </t-tag>
                      )}
                    </View>
                  </View>
                  <t-icon name="chevron-right" className="sessionArrow" />
                </View>
              </t-swipe-cell>
            </View>
          ))
        )}
      </View>

      <View className="fab" onClick={handleNewChat}>
        <t-button
          theme="primary"
          shape="circle"
          size="large"
          icon="add"
        />
      </View>
    </View>
  );
}
