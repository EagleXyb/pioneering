import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useCallback } from 'react';
import { AGENT_MODES, AGENT_MODE_LABELS, AGENT_MODE_DESCRIPTIONS } from '@/constants';
import { formatTime } from '@/utils';
import styles from './index.module.scss';

const MODE_CONFIG = [
  { key: AGENT_MODES.BRAINSTORM, emoji: '💡', color: 'brainstorm' },
  { key: AGENT_MODES.ANALYZE, emoji: '🔍', color: 'analyze' },
  { key: AGENT_MODES.CREATE, emoji: '✨', color: 'create' },
  { key: AGENT_MODES.EVALUATE, emoji: '🎯', color: 'evaluate' },
];

const MOCK_SESSIONS = [
  { id: '1', title: 'AI产品创新方向探索', preview: '基于当前市场趋势分析，AI在教育领域的应用...', mode: AGENT_MODES.BRAINSTORM, time: Date.now() - 3600000 },
  { id: '2', title: '小程序交互体验优化方案', preview: '针对用户反馈的页面加载速度问题，我们从三个维度...', mode: AGENT_MODES.ANALYZE, time: Date.now() - 86400000 },
  { id: '3', title: '品牌视觉体系升级策划', preview: '围绕年轻化、科技感两个关键词，为品牌制定...', mode: AGENT_MODES.CREATE, time: Date.now() - 172800000 },
];

const MOCK_CASES = [
  { id: '1', title: '爆款内容创意方法论', desc: 'AI辅助内容生产全流程', mode: AGENT_MODES.CREATE },
  { id: '2', title: '从0到1产品孵化', desc: '完整的需求分析与设计', mode: AGENT_MODES.BRAINSTORM },
  { id: '3', title: '竞品深度分析框架', desc: '系统化竞品研究方法', mode: AGENT_MODES.ANALYZE },
  { id: '4', title: '商业模式画布', desc: '创新商业模式设计', mode: AGENT_MODES.EVALUATE },
];

export default function Home() {
  const [recentSessions] = useState(MOCK_SESSIONS);

  const showToast = useCallback((title: string) => {
    Taro.showToast({ title, icon: 'none', duration: 1500 });
  }, []);

  return (
    <ScrollView className={styles['home-page']} scrollY enableBackToTop>
      <View className={styles['home-header']}>
        <View className={styles['home-header-greeting']}>AI 创意孵化引擎</View>
        <View className={styles['home-header-title']}>创路 Agent</View>
        <View className={styles['home-header-subtitle']}>激发灵感 · 深度思考 · 创造价值</View>
      </View>

      <View className={styles['home-modes']}>
        {MODE_CONFIG.map((item) => (
          <View
            key={item.key}
            className={styles['home-mode-card']}
            onClick={() => showToast('即将上线')}
          >
            <View className={`${styles['home-mode-icon']} ${styles[`home-mode-icon-${item.color}`]}`}>
              {item.emoji}
            </View>
            <View className={styles['home-mode-body']}>
              <View className={styles['home-mode-name']}>{AGENT_MODE_LABELS[item.key]}</View>
              <View className={styles['home-mode-desc']}>{AGENT_MODE_DESCRIPTIONS[item.key]}</View>
            </View>
          </View>
        ))}
      </View>

      <View className={styles['home-section']}>
        <View className={styles['home-section-header']}>
          <Text className={styles['home-section-title']}>最近对话</Text>
          <Text className={styles['home-section-more']} onClick={() => showToast('即将上线')}>更多</Text>
        </View>
        {recentSessions.map((session) => (
          <View
            key={session.id}
            className={styles['home-chat-entry']}
            onClick={() => showToast('即将上线')}
          >
            <View className={styles['home-chat-entry-avatar']}>AI</View>
            <View className={styles['home-chat-entry-body']}>
              <View className={styles['home-chat-entry-title']}>{session.title}</View>
              <View className={styles['home-chat-entry-preview']}>{session.preview}</View>
              <View className={styles['home-chat-entry-meta']}>
                <t-tag theme='primary' variant='light' size='small'>{AGENT_MODE_LABELS[session.mode]}</t-tag>
                <Text className={styles['home-chat-entry-time']}>{formatTime(session.time)}</Text>
              </View>
            </View>
          </View>
        ))}

        <View
          className={styles['home-chat-entry']}
          onClick={() => showToast('即将上线')}
          style={{ justifyContent: 'center', padding: '36rpx' }}
        >
          <Text style={{ fontSize: '28rpx', color: '#4f46e5', fontWeight: 500 }}>+ 开始新对话</Text>
        </View>
      </View>

      <View className={styles['home-section']}>
        <View className={styles['home-section-header']}>
          <Text className={styles['home-section-title']}>精选案例</Text>
          <Text className={styles['home-section-more']} onClick={() => showToast('即将上线')}>更多</Text>
        </View>
        <ScrollView className={styles['home-cases']} scrollX showScrollbar={false}>
          {MOCK_CASES.map((item) => (
            <View
              key={item.id}
              className={styles['home-case-item']}
              onClick={() => showToast('即将上线')}
            >
              <View className={`${styles['home-case-cover']} ${styles[`home-case-cover-${item.mode}`]}`}>
                {item.mode === AGENT_MODES.BRAINSTORM ? '💡' :
                 item.mode === AGENT_MODES.CREATE ? '✨' :
                 item.mode === AGENT_MODES.ANALYZE ? '🔍' : '🎯'}
              </View>
              <View className={styles['home-case-info']}>
                <View className={styles['home-case-name']}>{item.title}</View>
                <View className={styles['home-case-desc']}>{item.desc}</View>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={{ height: '40rpx' }} />
    </ScrollView>
  );
}
