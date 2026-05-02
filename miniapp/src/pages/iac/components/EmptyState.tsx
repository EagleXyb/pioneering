import { View, Text } from '@tarojs/components';
import React from 'react';
import type { ModeOption } from '../constants';
import { PROJECT_OPTIONS } from '../constants';
import './EmptyState.scss';

interface EmptyStateProps {
  selectedMode: string;
  onModeSelect: (id: string) => void;
}

export default function EmptyState({ selectedMode, onModeSelect }: EmptyStateProps) {
  return (
    <View className='empty-state'>
      <View className='empty-icon-wrap'>
        <Text className='empty-emoji'>💬</Text>
      </View>
      <Text className='empty-title'>开始对话</Text>
      <Text className='empty-desc'>选择模式后，开始您的智能体验之旅</Text>
      <View
        className='mode-quick-select'
        style={{
          '--active-index': PROJECT_OPTIONS.findIndex(opt => opt.id === selectedMode),
          '--total-items': PROJECT_OPTIONS.length,
        } as React.CSSProperties}
      >
        <View className='mode-selector-thumb' />
        {PROJECT_OPTIONS.map((opt: ModeOption) => (
          <View
            key={opt.id}
            className={`mode-chip ${selectedMode === opt.id ? 'active' : ''}`}
            onClick={() => onModeSelect(opt.id)}
          >
            <Text className='mode-chip-text'>{opt.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
