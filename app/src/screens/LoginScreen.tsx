import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { commonStyles } from '../theme/styles';
import { Colors, Spacing, BorderRadius, Typography } from '../theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  return (
    <View style={[commonStyles.container, commonStyles.center, { padding: Spacing.lg }]}>
      <View
        style={{
          width: '100%',
          maxWidth: 400,
          backgroundColor: Colors.background,
          borderRadius: BorderRadius.xl,
          padding: Spacing.xxl,
        }}
      >
        <Text style={{ ...Typography.h2, textAlign: 'center', marginBottom: Spacing.xs }}>
          IAC 创新孵化
        </Text>
        <Text
          style={{
            ...Typography.caption,
            textAlign: 'center',
            marginBottom: Spacing.xxl,
          }}
        >
          AI驱动的创新实践平台
        </Text>

        <TextInput
          style={[commonStyles.input, { marginBottom: Spacing.md }]}
          value={email}
          onChangeText={setEmail}
          placeholder="请输入邮箱"
          placeholderTextColor={Colors.secondary}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={[commonStyles.input, { marginBottom: Spacing.lg }]}
          value={name}
          onChangeText={setName}
          placeholder="请输入姓名"
          placeholderTextColor={Colors.secondary}
        />

        <TouchableOpacity style={commonStyles.buttonPrimary}>
          <Text style={commonStyles.buttonText}>登录</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
