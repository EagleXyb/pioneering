import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { commonStyles } from '../theme/styles';
import { Colors, Spacing, BorderRadius, Typography } from '../theme';
import { PROJECT_OPTIONS } from '../../../shared/constants';

export default function TrialCenterScreen() {
  const [selectedProject, setSelectedProject] = useState('normal');
  const [inputValue, setInputValue] = useState('');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={commonStyles.container}>
        <View
          style={{
            flexDirection: 'row',
            padding: Spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: Colors.borderLight,
          }}
        >
          {PROJECT_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.id}
              onPress={() => setSelectedProject(option.id)}
              style={{
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                borderRadius: BorderRadius.full,
                backgroundColor:
                  selectedProject === option.id ? Colors.accent : Colors.backgroundSecondary,
                marginRight: Spacing.sm,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: selectedProject === option.id ? '#fff' : Colors.secondary,
                }}
              >
                {option.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={{ flex: 1, padding: Spacing.lg }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        >
          <Text style={{ ...Typography.body, color: Colors.secondary, textAlign: 'center' }}>
            选择模式，开始体验
          </Text>
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            padding: Spacing.md,
            borderTopWidth: 1,
            borderTopColor: Colors.borderLight,
            backgroundColor: Colors.background,
          }}
        >
          <TextInput
            style={[commonStyles.input, { flex: 1, marginRight: Spacing.sm }]}
            value={inputValue}
            onChangeText={setInputValue}
            placeholder="输入消息..."
            placeholderTextColor={Colors.secondary}
          />
          <TouchableOpacity style={commonStyles.buttonPrimary}>
            <Text style={commonStyles.buttonText}>发送</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
