import { View, Text, Image, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import './index.scss';

interface KnowledgeBase {
  id: number;
  title: string;
  description: string;
  icon: string;
  views: number;
  contentCount: number;
  author: string;
  isVerified?: boolean;
}

interface RecommendItem {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  views: number;
  contentCount: number;
  author: string;
}

const featuredData: KnowledgeBase[] = [
  {
    id: 1,
    title: '宠医 AI 问诊知识库',
    description: '大猫异宠饲养管理及疫病诊断 AI 免费问诊，尽量把...',
    icon: '',
    views: 668,
    contentCount: 1938,
    author: '宠物诊疗师',
    isVerified: true
  },
  {
    id: 2,
    title: 'AI 思政课',
    description: '本知识库为大中小思政课教师和大学生提供马恩经...',
    icon: '',
    views: 1413,
    contentCount: 739,
    author: 'AI 思政课',
    isVerified: true
  },
  {
    id: 3,
    title: '朱老师 (很努力的班主任)',
    description: '我是一线语文老师、教研组长、小学班主任；我是...',
    icon: '',
    views: 824,
    contentCount: 970,
    author: '朱老师 (很努力的...',
    isVerified: true
  },
  {
    id: 4,
    title: '知识产权法律法规与案例库',
    description: '本库包含现行全部知识产权法律法规，2021年至今...',
    icon: '',
    views: 253,
    contentCount: 1141,
    author: '壹典法阁',
    isVerified: true
  }
];

const recommendData: RecommendItem[] = [
  {
    id: 1,
    title: 'A 股 / 港股股市研报分享',
    description: '研报隔周更新，处于版权原因，不予以公开',
    thumbnail: '',
    views: 3566,
    contentCount: 15114,
    author: '投研届得面包树'
  },
  {
    id: 2,
    title: '公众号写作知识库',
    description: '搜集了一些文章写作的技巧和推送知识，为自己和大...',
    thumbnail: '',
    views: 3636,
    contentCount: 216,
    author: '合木'
  },
  {
    id: 3,
    title: '向上管理 / 沟通 / 领导 / 上司 / 汇报',
    description: '混迹职场10余年的80后来告诉你，学会管理你的上...',
    thumbnail: '',
    views: 3485,
    contentCount: 16,
    author: '付明辉'
  }
];

const categories = ['推荐', '科技', '教育', '职场', '财经', '产业', '健康', '法律'];

export default function CaseLibrary() {
  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('推荐');

  const handleCardClick = (id: number) => {
    console.log('点击卡片:', id);
  };

  const handleRefresh = () => {
    console.log('换一换');
  };

  return (
    <View className='case-library-page'>
      <View className='search-bar'>
        <View className='search-input-wrapper'>
          <Image className='search-icon' src='/assets/case/search.png' mode='aspectFit' />
          <Input
            className='search-input'
            placeholder='搜索订阅知识库'
            value={searchValue}
            onInput={(e) => setSearchValue(e.detail.value)}
          />
        </View>
      </View>

      <View className='section'>
        <View className='section-header'>
          <Text className='section-title'>精选</Text>
          <View className='refresh-btn' onClick={handleRefresh}>
            <Image className='refresh-icon' src='/assets/case/refresh.png' mode='aspectFit' />
            <Text className='refresh-text'>换一换</Text>
          </View>
        </View>

        <View className='featured-list'>
          {featuredData.map((item) => (
            <View key={item.id} className='knowledge-card' onClick={() => handleCardClick(item.id)}>
              <View className='card-icon-wrapper'>
                {item.icon ? (
                  <Image className='card-icon' src={item.icon} mode='aspectFill' />
                ) : (
                  <Text className='card-icon-text'>📚</Text>
                )}
              </View>
              <View className='card-content'>
                <Text className='card-title'>{item.title}</Text>
                <Text className='card-desc'>{item.description}</Text>
                <View className='card-meta'>
                  <Text className='meta-item'>{item.views} 人订阅</Text>
                  <Text className='meta-divider'>|</Text>
                  <Text className='meta-item'>{item.contentCount} 个内容</Text>
                  <Text className='meta-divider'>|</Text>
                  <Text className='meta-author'>@{item.author}</Text>
                  {item.isVerified && <Text className='verified-badge'>✓</Text>}
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View className='section'>
        <View className='category-tabs'>
          {categories.map((category) => (
            <Text
              key={category}
              className={`category-tab ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </Text>
          ))}
        </View>

        <View className='recommend-list'>
          {recommendData.map((item) => (
            <View key={item.id} className='knowledge-card' onClick={() => handleCardClick(item.id)}>
              <View className='card-icon-wrapper'>
                {item.thumbnail ? (
                  <Image className='card-icon' src={item.thumbnail} mode='aspectFill' />
                ) : (
                  <Text className='card-icon-text'>📖</Text>
                )}
              </View>
              <View className='card-content'>
                <Text className='card-title'>{item.title}</Text>
                <Text className='card-desc'>{item.description}</Text>
                <View className='card-meta'>
                  <Text className='meta-item'>{item.views} 人订阅</Text>
                  <Text className='meta-divider'>|</Text>
                  <Text className='meta-item'>{item.contentCount} 个内容</Text>
                  <Text className='meta-divider'>|</Text>
                  <Text className='meta-author'>@{item.author}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
