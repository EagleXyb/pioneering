import { View, Text, Image, Input } from '@tarojs/components';
import { useReachBottom } from '@tarojs/taro';
import { useState, useCallback } from 'react';
import KnowledgeCard, { KnowledgeCardData } from '../../components/KnowledgeCard';
import './index.scss';

const PAGE_SIZE = 5;

const featuredData: KnowledgeCardData[] = [
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

const allRecommendData: KnowledgeCardData[] = [
  {
    id: 1,
    title: 'A 股 / 港股股市研报分享',
    description: '研报隔周更新，出于版权原因，不予以公开',
    icon: '',
    views: 3566,
    contentCount: 15114,
    author: '投研届得面包树'
  },
  {
    id: 2,
    title: '公众号写作知识库',
    description: '搜集了一些文章写作的技巧和推送知识，为自己和大...',
    icon: '',
    views: 3636,
    contentCount: 216,
    author: '合木'
  },
  {
    id: 3,
    title: '向上管理 / 沟通 / 领导 / 上司 / 汇报',
    description: '混迹职场10余年的80后来告诉你，学会管理你的上...',
    icon: '',
    views: 3485,
    contentCount: 16,
    author: '付明辉'
  },
  {
    id: 4,
    title: 'Python 编程从入门到实践',
    description: '涵盖 Python 基础语法、数据结构、常用库及项目...',
    icon: '',
    views: 2891,
    contentCount: 420,
    author: 'CodeMaster'
  },
  {
    id: 5,
    title: '设计模式与架构实践',
    description: '深入浅出讲解 23 种设计模式及微服务架构设计...',
    icon: '',
    views: 2156,
    contentCount: 328,
    author: '架构师之路'
  },
  {
    id: 6,
    title: '数据科学入门指南',
    description: '包含统计学基础、机器学习算法、数据分析工具链...',
    icon: '',
    views: 1943,
    contentCount: 267,
    author: 'DataGeek'
  }
];

const categories = ['推荐', '科技', '教育', '职场', '财经', '产业', '健康', '法律'];

export default function CaseLibrary() {
  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('推荐');
  const [displayedCount, setDisplayedCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const displayedRecommend = allRecommendData.slice(0, displayedCount);
  const hasMore = displayedCount < allRecommendData.length;

  const handleCardClick = useCallback((id: number) => {
    console.log('点击卡片:', id);
  }, []);

  const handleRefresh = useCallback(() => {
    console.log('换一换');
  }, []);

  const handleSearchInput = useCallback((e: { detail: { value: string } }) => {
    setSearchValue(e.detail.value);
  }, []);

  const handleCategoryChange = useCallback((category: string) => {
    setActiveCategory(category);
    setDisplayedCount(PAGE_SIZE);
  }, []);

  useReachBottom(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setDisplayedCount(c => c + PAGE_SIZE);
      setLoadingMore(false);
    }, 400);
  });

  return (
    <View className='case-library-page'>
      {/* 搜索栏 */}
      <View className='search-bar'>
        <View className='search-input-wrapper'>
          <Image className='search-icon' src='/assets/case/search.png' mode='aspectFit' />
          <Input
            className='search-input'
            placeholder='搜索订阅知识库'
            value={searchValue}
            onInput={handleSearchInput}
            confirmType='search'
          />
        </View>
      </View>

      {/* 精选模块 */}
      <View className='section section-featured'>
        <View className='section-header'>
          <Text className='section-title'>精选</Text>
          <View className='refresh-btn' onClick={handleRefresh} hoverClass='refresh-btn--hover'>
            <Image className='refresh-icon' src='/assets/case/refresh.png' mode='aspectFit' />
            <Text className='refresh-text'>换一换</Text>
          </View>
        </View>
        <View className='card-list'>
          {featuredData.map((item) => (
            <KnowledgeCard key={item.id} item={item} onClick={handleCardClick} />
          ))}
        </View>
      </View>

      {/* 推荐列表 */}
      <View className='section section-recommend'>
        <View className='category-tabs'>
          {categories.map((category) => (
            <Text
              key={category}
              className={`category-tab ${activeCategory === category ? 'active' : ''}`}
              onClick={() => handleCategoryChange(category)}
            >
              {category}
            </Text>
          ))}
        </View>
        <View className='card-list'>
          {displayedRecommend.map((item) => (
            <KnowledgeCard key={item.id} item={item} onClick={handleCardClick} />
          ))}
        </View>
        {loadingMore && (
          <View className='loading-more'>
            <Text className='loading-text'>加载中...</Text>
          </View>
        )}
        {!hasMore && displayedRecommend.length > 0 && (
          <View className='loading-more'>
            <Text className='loading-text'>— 已展示全部 —</Text>
          </View>
        )}
      </View>
    </View>
  );
}
