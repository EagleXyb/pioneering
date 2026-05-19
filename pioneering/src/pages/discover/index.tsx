import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { useState, useCallback } from 'react';
import { useRequest } from '@/hooks';
import Loading from '@/components/Loading';
import Empty from '@/components/Empty';
import './index.scss';

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'brainstorm', label: '头脑风暴' },
  { key: 'analyze', label: '深度分析' },
  { key: 'create', label: '创意生成' },
  { key: 'evaluate', label: '方案评估' },
];

const MOCK_CASES = [
  {
    id: '1', title: 'AI产品从0到1全流程', desc: '基于真实项目经验，分享AI产品从创意到上线的完整方法论与避坑指南。',
    mode: 'brainstorm', views: 2341, color: 1,
  },
  {
    id: '2', title: '用户增长策略体系', desc: '构建可量化的增长模型，涵盖获客、激活、留存、变现全链路策略设计。',
    mode: 'analyze', views: 1876, color: 2,
  },
  {
    id: '3', title: '品牌视觉升级方案', desc: '从品牌诊断到视觉落地，提供系统化的品牌升级路径与设计规范。',
    mode: 'create', views: 1523, color: 3,
  },
  {
    id: '4', title: '商业模式创新设计', desc: '运用商业模式画布和价值主张设计，重构盈利模型与竞争壁垒。',
    mode: 'evaluate', views: 1205, color: 4,
  },
  {
    id: '5', title: '产品矩阵规划方法论', desc: '从单一产品到产品矩阵的演进策略，匹配不同阶段的资源投入。',
    mode: 'brainstorm', views: 987, color: 1,
  },
  {
    id: '6', title: '技术架构演进之路', desc: '从单体到微服务的技术架构演进路径，附典型决策案例分析。',
    mode: 'analyze', views: 876, color: 2,
  },
];

export default function Discover() {
  const [activeCategory, setActiveCategory] = useState('all');

  const { loading, error, refresh } = useRequest(async () => {
    await new Promise((r) => setTimeout(r, 600));
    return MOCK_CASES;
  }, { manual: true });

  const filteredCases =
    activeCategory === 'all'
      ? MOCK_CASES
      : MOCK_CASES.filter((c) => c.mode === activeCategory);

  const navigateToChat = useCallback((mode: string) => {
    Taro.navigateTo({ url: `/pages/chat/index?mode=${mode}` });
  }, []);

  usePullDownRefresh(() => {
    refresh();
    Taro.stopPullDownRefresh();
  });

  if (loading) return <Loading text="加载中..." fullscreen />;
  if (error) return <Empty text="加载失败" actionText="点击重试" onAction={refresh} />;

  return (
    <ScrollView className="discover-page" scrollY enableBackToTop>
      <View className="discover-header">
        <View className="discover-header-title">发现</View>
        <View className="discover-header-subtitle">探索优秀案例，激发创意灵感</View>
      </View>

      <View className="discover-search">
        <Text className="discover-search-icon">🔍</Text>
        <Text>搜索灵感案例...</Text>
      </View>

      <ScrollView className="discover-categories" scrollX showScrollbar={false}>
        {CATEGORIES.map((cat) => (
          <View
            key={cat.key}
            className={`discover-category${activeCategory === cat.key ? ' active' : ''}`}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.label}
          </View>
        ))}
      </ScrollView>

      <View className="discover-grid">
        {filteredCases.map((item) => (
          <View
            key={item.id}
            className="discover-card"
            onClick={() => navigateToChat(item.mode)}
          >
            <View className={`discover-card-cover discover-card-cover-${item.color}`}>
              <Text>
                {item.mode === 'brainstorm' ? '💡' :
                 item.mode === 'analyze' ? '🔍' :
                 item.mode === 'create' ? '✨' : '🎯'}
              </Text>
            </View>
            <View className="discover-card-body">
              <View className="discover-card-title">{item.title}</View>
              <View className="discover-card-desc">{item.desc}</View>
              <View className="discover-card-meta">
                <Text className="discover-card-tag">{CATEGORIES.find((c) => c.key === item.mode)?.label}</Text>
                <Text className="discover-card-stats">{item.views}人浏览</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
