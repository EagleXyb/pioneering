import React from 'react';
import { View, Text } from 'react-native';
import { commonStyles } from '../theme/styles';

export default function IncubationScreen() {
  return (
    <View style={[commonStyles.container, commonStyles.center]}>
      <Text style={commonStyles.subtitle}>创意孵化 - 开发中</Text>
    </View>
  );
}
