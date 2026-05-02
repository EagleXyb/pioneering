import { View, Text, ScrollView, Image } from '@tarojs/components';
import { useEffect, useState } from 'react';
import type { ModelItem } from '../constants';
import networkIcon from '../../../assets/iac/Network.png';
import deepThinkingIcon from '../../../assets/iac/Deep-Thinking.png';
import './ModeSheet.scss';

interface ModeSheetProps {
  visible: boolean;
  selectedModel: string;
  searchEnabled: boolean;
  thinkingMode: 'fast' | 'deep';
  models: ModelItem[];
  onSelectModel: (id: string) => void;
  onToggleSearch: () => void;
  onToggleThinkingMode: (mode: 'fast' | 'deep') => void;
  onClose: () => void;
}

export default function ModeSheet({
  visible,
  selectedModel,
  searchEnabled,
  thinkingMode,
  models,
  onSelectModel,
  onToggleSearch,
  onToggleThinkingMode,
  onClose,
}: ModeSheetProps) {
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        setAnimating(true);
      });
    } else {
      setAnimating(false);
    }
  }, [visible]);

  if (!visible && !animating) return null;

  return (
    <View
      className={`mode-sheet-mask ${visible && animating ? 'mode-sheet-mask--visible' : ''}`}
      catchMove
      onClick={onClose}
    >
      <View
        className={`mode-sheet ${visible && animating ? 'mode-sheet--open' : ''}`}
        catchMove
        onClick={(e) => e.stopPropagation()}
      >
        <View className='mode-sheet-drag-bar'>
          <View className='mode-sheet-drag-handle' />
        </View>

        <ScrollView className='mode-sheet-body' scrollY enhanced showScrollbar={false}>
          <View className='mode-card'>
            <View className='mode-card-row'>
              <View className='mode-card-row-left'>
                <Image className='mode-card-row-icon' src={networkIcon} mode='aspectFit' />
                <Text className='mode-card-row-label'>联网搜索</Text>
              </View>
              <View
                className={`mode-toggle ${searchEnabled ? 'mode-toggle--on' : ''}`}
                onClick={onToggleSearch}
              >
                <View className='mode-toggle-thumb' />
              </View>
            </View>

            <View className='mode-card-row'>
              <View className='mode-card-row-left'>
                <Image className='mode-card-row-icon' src={deepThinkingIcon} mode='aspectFit' />
                <Text className='mode-card-row-label'>思考模式</Text>
              </View>
              <View className='mode-segment'>
                <View
                  className={`mode-segment-item ${thinkingMode === 'fast' ? 'mode-segment-item--active' : ''}`}
                  onClick={() => onToggleThinkingMode('fast')}
                >
                  <Text className='mode-segment-text'>快速</Text>
                </View>
                <View
                  className={`mode-segment-item ${thinkingMode === 'deep' ? 'mode-segment-item--active' : ''}`}
                  onClick={() => onToggleThinkingMode('deep')}
                >
                  <Text className='mode-segment-text'>深度</Text>
                </View>
              </View>
            </View>
          </View>

          <View className='mode-card'>
            {models.map((model) => (
              <View
                key={model.id}
                className='mode-model-item'
                onClick={() => onSelectModel(model.id)}
                hoverClass='mode-model-item--hover'
              >
                <View className='mode-model-info'>
                  <Text className='mode-model-name'>{model.name}</Text>
                  <Text className='mode-model-desc'>{model.description}</Text>
                </View>
                {selectedModel === model.id && (
                  <Text className='mode-model-check'>✓</Text>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
