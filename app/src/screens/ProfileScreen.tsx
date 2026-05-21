import React from 'react';
import { View, Text, ScrollView, Image } from 'react-native';
import { commonStyles } from '../theme/styles';
import { Colors, Spacing, Typography } from '../theme';

export default function ProfileScreen() {
  return (
    <ScrollView style={commonStyles.container} contentContainerStyle={{ padding: Spacing.lg }}>
      <View style={{ alignItems: 'center', paddingVertical: Spacing.xxl }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: Colors.backgroundSecondary,
            marginBottom: Spacing.md,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 32 }}>👤</Text>
        </View>
        <Text style={commonStyles.title}>张三</Text>
        <Text style={{ ...Typography.caption, marginTop: Spacing.xs }}>
          zhangsan@example.com
        </Text>
      </View>

      <View style={commonStyles.card}>
        {[
          { label: '公司', value: '创新科技有限公司' },
          { label: '职位', value: '产品经理' },
          { label: '地区', value: '北京市海淀区' },
        ].map((item, index) => (
          <View
            key={item.label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingVertical: Spacing.md,
              borderBottomWidth: index < 2 ? 1 : 0,
              borderBottomColor: Colors.borderLight,
            }}
          >
            <Text style={{ ...Typography.body, color: Colors.secondary }}>{item.label}</Text>
            <Text style={Typography.body}>{item.value}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
