import { View, Text } from '@tarojs/components';
import type { ChatMessage } from '../hooks/useChatSession';
import './MessageBubble.scss';

interface MessageBubbleProps {
  message: ChatMessage;
  onAcceptInsight?: (msgId: string) => void;
  onReviseInsight?: (msgId: string) => void;
  onSelectAction?: (title: string) => void;
}

export default function MessageBubble({
  message,
  onAcceptInsight,
  onReviseInsight,
  onSelectAction,
}: MessageBubbleProps) {
  const { id, content, isUser, type, insightData, actionData, timestamp } = message;

  const timeStr = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // 洞察卡片
  if (type === 'insight' && insightData) {
    const resolved = (insightData as any).accepted || (insightData as any).revised;
    return (
      <View className='insight-card-inline'>
        <Text className='insight-label'>{insightData.label}</Text>
        <Text className='insight-title'>{insightData.title}</Text>
        <Text className='insight-body'>{insightData.body}</Text>
        <View className='insight-evidence'>
          {insightData.evidence.map((e, i) => (
            <View key={i} className='insight-evidence-item'>
              <Text>▸ {e}</Text>
            </View>
          ))}
        </View>
        {!resolved && (
          <View className='insight-actions'>
            <View className='insight-btn insight-btn-accept' onClick={() => onAcceptInsight?.(id)}>
              <Text>✓ 这就是我！</Text>
            </View>
            <View className='insight-btn insight-btn-revise' onClick={() => onReviseInsight?.(id)}>
              <Text>✎ 部分对，再说说</Text>
            </View>
          </View>
        )}
        {resolved && (
          <View className='insight-resolved'>
            <Text>✓ 已保存到洞察本</Text>
          </View>
        )}
      </View>
    );
  }

  // 行动卡片
  if (type === 'action' && actionData) {
    return (
      <View className='action-card-inline'>
        <Text className='action-label'>{actionData.label}</Text>
        {actionData.items.map((item, i) => (
          <View
            key={i}
            className='action-item'
            onClick={() => onSelectAction?.(item.title)}
          >
            <Text className='action-item-title'>{item.title}</Text>
            <Text className='action-item-desc'>{item.desc}</Text>
            <View className='action-item-meta'>
              <Text>风险 {item.risk}</Text>
              <Text>潜力 {item.potential}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }

  // 普通消息
  return (
    <View className={`msg ${isUser ? 'msg-user' : 'msg-agent'}`}>
      <View className='msg-bubble'>
        <Text>{content}</Text>
      </View>
      <Text className='msg-meta'>{timeStr}</Text>
    </View>
  );
}

// 打字指示器组件
export function TypingIndicator() {
  return (
    <View className='typing-indicator'>
      <View className='typing-dot' />
      <View className='typing-dot' />
      <View className='typing-dot' />
    </View>
  );
}
