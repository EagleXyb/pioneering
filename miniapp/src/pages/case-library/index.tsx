import { View, Text } from '@tarojs/components';
import './index.scss';

export default function CaseLibrary() {
  return (
    <View className='page'>
      <View className='placeholder'>
        <View className='placeholder-icon'>📚</View>
        <Text className='placeholder-title'>案例库</Text>
        <Text className='placeholder-desc'>精彩案例，敬请期待</Text>
      </View>
    </View>
  );
}