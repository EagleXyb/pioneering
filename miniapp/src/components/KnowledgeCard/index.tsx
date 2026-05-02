import { View, Text, Image } from '@tarojs/components';
import './index.scss';

export interface KnowledgeCardData {
  id: number;
  title: string;
  description: string;
  icon: string;
  views: number;
  contentCount: number;
  author: string;
  isVerified?: boolean;
}

interface KnowledgeCardProps {
  item: KnowledgeCardData;
  onClick: (id: number) => void;
}

export default function KnowledgeCard({ item, onClick }: KnowledgeCardProps) {
  return (
    <View className='knowledge-card' onClick={() => onClick(item.id)} hoverClass='knowledge-card--hover'>
      <View className='card-icon-wrapper'>
        {item.icon ? (
          <Image className='card-icon' src={item.icon} mode='aspectFill' />
        ) : (
          <View className='card-icon-placeholder'>
            <Text className='card-icon-emoji'>📚</Text>
          </View>
        )}
      </View>
      <View className='card-body'>
        <Text className='card-title'>{item.title}</Text>
        <Text className='card-desc'>{item.description}</Text>
        <View className='card-footer'>
          <View className='card-meta'>
            <Text className='meta-item'>{item.views} 人订阅</Text>
            <Text className='meta-divider'>|</Text>
            <Text className='meta-item'>{item.contentCount} 个内容</Text>
          </View>
          <View className='card-meta-right'>
            <Text className='meta-author'>@{item.author}</Text>
            {item.isVerified && <View className='verified-badge'>✓</View>}
          </View>
        </View>
      </View>
    </View>
  );
}
