import { View, Text, Input } from '@tarojs/components';
import { useState } from 'react';
import './index.scss';

const PROJECT_OPTIONS = [
  { id: 'normal', name: '普通模式', description: '适配多元场景支持多轮对话' },
  { id: 'professional', name: '专业模式', description: '聚焦专业领域精准交付成果' },
  { id: 'task', name: '任务模式', description: '承接复杂任务高效推进落地' },
];

export default function TrialCenter() {
  const [selectedProject, setSelectedProject] = useState('normal');
  const [inputValue, setInputValue] = useState('');

  const onSend = () => {
    if (!inputValue.trim()) return;
    setInputValue('');
  };

  return (
    <View className='page'>
      <View className='project-selector'>
        {PROJECT_OPTIONS.map((option) => (
          <View
            key={option.id}
            className={`project-option ${selectedProject === option.id ? 'active' : ''}`}
            onClick={() => setSelectedProject(option.id)}
          >
            <Text className='project-name'>{option.name}</Text>
          </View>
        ))}
      </View>

      <View className='chat-area'>
        <View className='empty-hint'>
          <Text className='empty-text'>选择模式，开始体验</Text>
        </View>
      </View>

      <View className='input-bar'>
        <Input
          className='input'
          value={inputValue}
          onInput={(e) => setInputValue(e.detail.value)}
          placeholder='输入消息...'
          confirmType='send'
          onConfirm={onSend}
        />
        <View className='send-btn' onClick={onSend}>
          <Text>发送</Text>
        </View>
      </View>
    </View>
  );
}
