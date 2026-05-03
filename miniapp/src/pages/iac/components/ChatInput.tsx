import { View, Text, Image, Textarea } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useRef } from 'react';
import sendIcon from '../../../assets/input/send.png';
import addIcon from '../../../assets/input/add.png';
import closeIcon from '../../../assets/input/close.png';
import voiceIcon from '../../../assets/input/voice.png';
import softKeyboardIcon from '../../../assets/input/keyboard.png';
import networkIcon from '../../../assets/iac/Network.png';
import disableNetworkIcon from '../../../assets/iac/Disable-Network.png';
import { PROJECT_OPTIONS, MODEL_LIST, EXPAND_ITEMS } from '../constants';
import type { ExpandItem } from '../constants';
import './ChatInput.scss';

interface ChatInputProps {
  inputValue: string;
  isSending: boolean;
  isVoiceMode: boolean;
  isExpanded: boolean;
  selectedMode: string;
  thinkingMode: 'fast' | 'deep';
  selectedModel: string;
  searchEnabled: boolean;
  canSend: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
  onStopGenerate: () => void;
  onToggleVoiceMode: () => void;
  onToggleKeyboardMode: () => void;
  onToggleExpand: () => void;
  onToggleModeSheet: () => void;
  onExpandItemTap: (key: string) => void;
}

const MODEL_SHORT_NAME_MAP: Record<string, string> = {
  'deepseek-flash': 'DSF',
  'deepseek-pro': 'DSP',
  'glm-5.1': 'GLM',
};

export default function ChatInput({
  inputValue,
  isSending,
  isVoiceMode,
  isExpanded,
  selectedMode,
  thinkingMode,
  selectedModel,
  searchEnabled,
  canSend,
  onInput,
  onSend,
  onStopGenerate,
  onToggleVoiceMode,
  onToggleKeyboardMode,
  onToggleExpand,
  onToggleModeSheet,
  onExpandItemTap,
}: ChatInputProps) {
  const isVoiceRecordingRef = useRef(false);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentMode = PROJECT_OPTIONS.find((opt) => opt.id === selectedMode);
  const modelShortName = MODEL_SHORT_NAME_MAP[selectedModel] || currentMode?.shortName || '';
  const thinkingLabel = thinkingMode === 'fast' ? '快速' : '深度';
  const currentModeLabel = `${modelShortName} ${thinkingLabel}`;
  const modeIcon = searchEnabled ? networkIcon : disableNetworkIcon;

  const onVoiceRecordStart = useCallback((e: any) => {
    e.preventDefault();
    isVoiceRecordingRef.current = false;
    voiceTimerRef.current = setTimeout(() => {
      isVoiceRecordingRef.current = true;
      Taro.vibrateShort({ type: 'light' });
      Taro.showToast({ title: '录音中...', icon: 'none', duration: 60000 });
    }, 200);
  }, []);

  const onVoiceRecordEnd = useCallback(
    (e: any) => {
      e.preventDefault();
      if (voiceTimerRef.current) {
        clearTimeout(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
      if (!isVoiceRecordingRef.current) return;
      isVoiceRecordingRef.current = false;
      Taro.hideToast();
      Taro.showToast({ title: '识别中...', icon: 'loading' });
      setTimeout(() => {
        Taro.hideToast();
        onInput('[语音消息]');
        onToggleKeyboardMode();
      }, 800);
    },
    [onInput, onToggleKeyboardMode],
  );

  return (
    <View className='input-bar'>
      <View className='input-container'>
        {!isVoiceMode ? (
          <View className='input-field'>
            <Textarea
              className='input'
              value={inputValue}
              onInput={(e) => onInput(e.detail.value)}
              placeholder='有问题尽管问IAC'
              confirmType='send'
              onConfirm={onSend}
              autoHeight
              maxlength={-1}
              disableDefaultPadding
              cursorSpacing={16}
              adjustPosition
            />
          </View>
        ) : (
          <View
            className='voice-hold-area'
            onTouchStart={onVoiceRecordStart}
            onTouchEnd={onVoiceRecordEnd}
            onTouchCancel={onVoiceRecordEnd}
          >
            <Text className='voice-hold-text'>按住 说话</Text>
          </View>
        )}

        <View className='toolbar'>
          <View className='toolbar-left'>
            <View className='mode-btn' onClick={onToggleModeSheet}>
              <Image className='mode-icon-img' src={modeIcon} mode='aspectFit' />
              <View className='mode-divider' />
              <Text className='mode-label'>{currentModeLabel}</Text>
              <View className='dropdown-arrow' />
            </View>
          </View>

          <View className='toolbar-right'>
            {!isSending && (
              <View
                className={`tool-btn voice-btn ${isVoiceMode ? 'active' : ''}`}
                onClick={isVoiceMode ? onToggleKeyboardMode : onToggleVoiceMode}
              >
                <Image
                  className='tool-icon-img'
                  src={isVoiceMode ? softKeyboardIcon : voiceIcon}
                  mode='aspectFit'
                />
              </View>
            )}

            {isSending ? (
              <View className='action-btn stop-btn' onClick={onStopGenerate}>
                <View className='stop-icon-box'>
                  <Text className='stop-icon'>■</Text>
                </View>
                <Text className='stop-label'>停止</Text>
              </View>
            ) : canSend ? (
              <View className='tool-btn send-mode-btn' onClick={onSend}>
                <Image className='tool-icon-img' src={sendIcon} mode='aspectFit' />
              </View>
            ) : (
              <View className={`tool-btn expand-btn ${isExpanded ? 'expanded' : ''}`} onClick={onToggleExpand}>
                <Image
                  className='tool-icon-img expand-icon-img'
                  src={isExpanded ? closeIcon : addIcon}
                  mode='aspectFit'
                />
              </View>
            )}
          </View>
        </View>

        {isExpanded && (
          <View className='expand-panel' catchMove>
            {EXPAND_ITEMS.map((item: ExpandItem) => (
              <View
                key={item.key}
                className='expand-item'
                onClick={() => onExpandItemTap(item.key)}
              >
                <View className='expand-icon-wrap'>
                  <Image className={`expand-icon-img expand-icon-${item.key}`} src={item.icon} mode='aspectFit' />
                </View>
                <Text className='expand-label'>{item.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
