// 创建Prompt对话框（TDesign 重构版）

import React, { useRef, useState } from 'react';
import { Dialog, Form, Input, Textarea } from 'tdesign-react';
import type { FormRule } from 'tdesign-react';
import type { CreatePromptFormData } from './types';

const { FormItem } = Form;

interface CreatePromptModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: CreatePromptFormData) => void;
}

// 表单验证规则
const FORM_RULES: Record<string, FormRule[]> = {
  promptKey: [
    { required: true, message: 'PromptKey不能为空' },
    { pattern: /^[a-zA-Z0-9_-]+$/, message: '只能包含字母、数字、下划线和连字符' },
    { min: 3, message: 'PromptKey长度不能少于3个字符' },
    { max: 100, message: 'PromptKey长度不能超过100个字符' },
  ],
  name: [
    { required: true, message: 'Prompt名称不能为空' },
    { max: 100, message: 'Prompt名称最多100个字符' },
  ],
  description: [
    { max: 500, message: 'Prompt描述最多500个字符' },
  ],
};

const INITIAL_DATA: CreatePromptFormData = {
  promptKey: '',
  name: '',
  description: '',
};

export const CreatePromptModal: React.FC<CreatePromptModalProps> = ({
  visible,
  onClose,
  onConfirm,
}) => {
  const [formData, setFormData] = useState<CreatePromptFormData>(INITIAL_DATA);
  const formRef = useRef<any>(null);

  const resetForm = () => {
    setFormData(INITIAL_DATA);
    formRef.current?.clearValidate();
  };

  const handleConfirm = async () => {
    const validateResult = await formRef.current?.validate?.();
    if (validateResult === true) {
      onConfirm(formData);
      resetForm();
    }
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  const handleFieldChange = (field: keyof CreatePromptFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog
      header="创建 Prompt"
      visible={visible}
      onClose={handleCancel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      confirmBtn="确认"
      cancelBtn="取消"
      width={520}
      destroyOnClose
    >
      <Form
        ref={formRef}
        data={formData}
        rules={FORM_RULES}
        labelWidth={0}
        layout="vertical"
        style={{ padding: '8px 0' }}
      >
        <FormItem label="Prompt Key" name="promptKey" requiredMark>
          <Input
            placeholder="请输入 Prompt Key"
            value={formData.promptKey}
            onChange={(val) => handleFieldChange('promptKey', val as string)}
            tips={`${formData.promptKey.length}/100`}
          />
        </FormItem>

        <FormItem label="Prompt 名称" name="name" requiredMark>
          <Input
            placeholder="请输入 Prompt 名称"
            value={formData.name}
            onChange={(val) => handleFieldChange('name', val as string)}
            tips={`${formData.name.length}/100`}
          />
        </FormItem>

        <FormItem label="Prompt 描述" name="description">
          <Textarea
            placeholder="请输入 Prompt 描述（选填）"
            value={formData.description}
            onChange={(val) => handleFieldChange('description', val as string)}
            rows={4}
            tips={`${formData.description.length}/500`}
          />
        </FormItem>
      </Form>
    </Dialog>
  );
};