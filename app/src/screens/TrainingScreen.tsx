import React from 'react';
import { View, Text } from 'react-native';
import { commonStyles } from '../theme/styles';

export default function TrainingScreen() {
  return (
    <View style={[commonStyles.container, commonStyles.center]}>
      <Text style={commonStyles.subtitle}>创新训练 - 开发中</Text>
    </View>
  );
}
