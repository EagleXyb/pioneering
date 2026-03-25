// 创建Prompt模态框组件

import React, { useState } from 'react';
import type { CreatePromptFormData } from './types';
import '../PromptManagement.css';

interface CreatePromptModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: CreatePromptFormData) => void;
}

export const CreatePromptModal: React.FC<CreatePromptModalProps> = ({
  visible,
  onClose,
  onConfirm,
}) => {
  const [formData, setFormData] = useState<CreatePromptFormData>({
    promptKey: '',
    name: '',
    description: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CreatePromptFormData, string>>>({});

  // 表单验证
  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof CreatePromptFormData, string>> = {};

    // 验证 PromptKey
    if (!formData.promptKey.trim()) {
      newErrors.promptKey = 'PromptKey不能为空';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.promptKey)) {
      newErrors.promptKey = 'PromptKey只能包含字母、数字、下划线和连字符';
    } else if (formData.promptKey.length < 3 || formData.promptKey.length > 100) {
      newErrors.promptKey = 'PromptKey长度应在3-100个字符之间';
    }

    // 验证名称
    if (!formData.name.trim()) {
      newErrors.name = 'Prompt名称不能为空';
    } else if (formData.name.length > 100) {
      newErrors.name = 'Prompt名称最多100个字符';
    }

    // 描述可选，但如果填写了需要限制长度
    if (formData.description && formData.description.length > 500) {
      newErrors.description = 'Prompt描述最多500个字符';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 处理确认
  const handleConfirm = () => {
    if (validate()) {
      onConfirm(formData);
      // 重置表单
      setFormData({ promptKey: '', name: '', description: '' });
      setErrors({});
    }
  };

  // 处理取消
  const handleCancel = () => {
    // 重置表单
    setFormData({ promptKey: '', name: '', description: '' });
    setErrors({});
    onClose();
  };

  // 处理输入变化
  const handleInputChange = (field: keyof CreatePromptFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // 清除该字段的错误
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  if (!visible) return null;

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>新建Prompt</h3>
          <button className="modal-close-btn" onClick={handleCancel}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">
              PromptKey
              <span className="label-required">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={formData.promptKey}
              onChange={(e) => handleInputChange('promptKey', e.target.value)}
              placeholder="请输入PromptKey（字母、数字、下划线、连字符）"
              autoFocus
            />
            {errors.promptKey && <span className="form-error">{errors.promptKey}</span>}
            <span className="form-hint">用于唯一标识Prompt，如：system_default_v2</span>
          </div>

          <div className="form-group">
            <label className="form-label">
              Prompt名称
              <span className="label-required">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="请输入Prompt名称"
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Prompt描述</label>
            <textarea
              className="form-textarea"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="请输入Prompt描述（可选）"
              rows={4}
            />
            {errors.description && <span className="form-error">{errors.description}</span>}
            <span className="form-hint">简要描述Prompt的用途和内容</span>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleCancel}>
            取消
          </button>
          <button className="btn-primary" onClick={handleConfirm}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
};
