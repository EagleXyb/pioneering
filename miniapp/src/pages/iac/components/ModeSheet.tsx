import { View, Text, Image } from '@tarojs/components';
import type { ModeOption } from '../constants';
import './ModeSheet.scss';

interface ModeSheetProps {
  visible: boolean;
  selectedMode: string;
  options: ModeOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function ModeSheet({ visible, selectedMode, options, onSelect, onClose }: ModeSheetProps) {
  if (!visible) return null;

  return (
    <View className='mode-sheet-mask' onClick={onClose}>
      <View className='mode-sheet' catchMove onClick={(e) => e.stopPropagation()}>
        <View className='mode-sheet-header'>
          <Text className='mode-sheet-title'>选择模型</Text>
          <View className='mode-sheet-close' onClick={onClose}>
            <Text className='mode-sheet-close-text'>✕</Text>
          </View>
        </View>
        <View className='mode-sheet-list'>
          {options.map((option) => (
            <View
              key={option.id}
              className={`mode-sheet-item ${selectedMode === option.id ? 'active' : ''}`}
              onClick={() => onSelect(option.id)}
            >
              <Image
                className='mode-sheet-icon'
                src={selectedMode === option.id ? option.selectedIcon : option.icon}
                mode='aspectFit'
              />
              <View className='mode-sheet-info'>
                <Text className='mode-sheet-name'>{option.name}</Text>
                <Text className='mode-sheet-desc'>{option.description}</Text>
              </View>
              {selectedMode === option.id && <Text className='mode-sheet-check'>✓</Text>}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
