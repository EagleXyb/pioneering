import { View, Text, ScrollView } from '@tarojs/components';
import './SidebarDrawer.scss';

interface GroupItem {
  id: string;
  name: string;
}

interface HistoryItem {
  id: string;
  title: string;
}

interface SidebarDrawerProps {
  visible: boolean;
  onClose: () => void;
  onNewChat: () => void;
  groups: GroupItem[];
  historyList: HistoryItem[];
  onGroupClick: (id: string) => void;
  onHistoryClick: (id: string) => void;
  onAddGroup: () => void;
  onMoreHistory: () => void;
}

export default function SidebarDrawer({
  visible,
  onClose,
  onNewChat,
  groups,
  historyList,
  onGroupClick,
  onHistoryClick,
  onAddGroup,
  onMoreHistory,
}: SidebarDrawerProps) {
  if (!visible) return null;

  return (
    <View className='sidebar-overlay' catchMove>
      <View className='sidebar-mask' onClick={onClose} />
      <View className={`sidebar-panel ${visible ? 'sidebar-panel--open' : ''}`}>
        <View className='sidebar-topbar'>
          <Text className='sidebar-title'>IAC</Text>
          <View className='sidebar-topbar-actions'>
            <View className='sidebar-icon-btn' onClick={onClose}>
              <Text className='sidebar-icon'>✕</Text>
            </View>
          </View>
        </View>

        <View className='sidebar-new-chat' onClick={onNewChat}>
          <Text className='sidebar-new-chat-icon'>✚</Text>
          <Text className='sidebar-new-chat-text'>新建对话</Text>
        </View>

        <View className='sidebar-section'>
          <View className='sidebar-section-header'>
            <Text className='sidebar-section-title'>分组</Text>
            <View className='sidebar-icon-btn sidebar-icon-btn--sm' onClick={onAddGroup}>
              <Text className='sidebar-icon sidebar-icon--sm'>＋</Text>
            </View>
          </View>
          <View className='sidebar-section-body'>
            {groups.map((group) => (
              <View
                key={group.id}
                className='sidebar-group-item'
                onClick={() => onGroupClick(group.id)}
                hoverClass='sidebar-item--hover'
              >
                <View className='sidebar-group-item-left'>
                  <Text className='sidebar-group-folder-icon'>📁</Text>
                  <Text className='sidebar-group-name'>{group.name}</Text>
                </View>
                <Text className='sidebar-group-pin-icon'>📌</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='sidebar-section sidebar-section--history'>
          <View className='sidebar-section-header'>
            <Text className='sidebar-section-title'>历史对话</Text>
            <View className='sidebar-icon-btn sidebar-icon-btn--sm' onClick={onMoreHistory}>
              <Text className='sidebar-icon sidebar-icon--sm'>⋯</Text>
            </View>
          </View>
          <ScrollView className='sidebar-history-list' scrollY>
            {historyList.map((item) => (
              <View
                key={item.id}
                className='sidebar-history-item'
                onClick={() => onHistoryClick(item.id)}
                hoverClass='sidebar-item--hover'
              >
                <Text className='sidebar-history-text'>{item.title}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}
