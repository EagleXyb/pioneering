import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { commonStyles } from '../theme/styles';
import { Colors, Spacing, BorderRadius, Typography } from '../theme';

interface FeatureItem {
  id: string;
  title: string;
  desc: string;
  icon: string;
}

const FEATURES: FeatureItem[] = [
  { id: 'assessment', title: '创新评估', desc: 'AI驱动的创新能力测评', icon: '📊' },
  { id: 'training', title: '创新训练', desc: '系统化的创新能力提升', icon: '🎯' },
  { id: 'incubation', title: '创意孵化', desc: '从创意到落地的全流程', icon: '🚀' },
  { id: 'experience', title: '创新体验', desc: '沉浸式创新工具集', icon: '✨' },
];

export default function HomeScreen() {
  const router = useRouter();

  const handleFeaturePress = (id: string) => {
    const routeMap: Record<string, string> = {
      assessment: '/assessment',
      training: '/training',
      incubation: '/incubation',
      experience: '/trial-center',
    };
    const route = routeMap[id];
    if (route) {
      router.push(route);
    }
  };

  return (
    <ScrollView style={commonStyles.container} contentContainerStyle={{ padding: Spacing.lg }}>
      <View style={{ marginBottom: Spacing.xxl }}>
        <Text style={{ ...Typography.caption, marginBottom: Spacing.xs }}>欢迎使用</Text>
        <Text style={commonStyles.title}>IAC 创新孵化平台</Text>
      </View>

      {FEATURES.map((feature) => (
        <TouchableOpacity
          key={feature.id}
          style={commonStyles.card}
          onPress={() => handleFeaturePress(feature.id)}
          activeOpacity={0.7}
        >
          <View style={commonStyles.row}>
            <Text style={{ fontSize: 40, marginRight: Spacing.md }}>{feature.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ ...Typography.h3, color: Colors.primary }}>{feature.title}</Text>
              <Text style={commonStyles.subtitle}>{feature.desc}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
