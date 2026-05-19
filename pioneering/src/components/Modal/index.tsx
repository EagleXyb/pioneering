import { View, ScrollView } from '@tarojs/components';
import type { CSSProperties, ReactNode } from 'react';
import './index.scss';

interface ModalProps {
  visible: boolean;
  title?: string;
  closable?: boolean;
  maskClosable?: boolean;
  className?: string;
  style?: CSSProperties;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

export default function Modal({
  visible,
  title,
  closable = true,
  maskClosable = true,
  className = '',
  style,
  onClose,
  children,
  footer,
}: ModalProps) {
  if (!visible) return null;

  return (
    <View className="modal-root" catchMove>
      <View
        className="modal-mask"
        onClick={maskClosable ? onClose : undefined}
      />
      <View className={`modal-container ${className}`} style={style}>
        {(title || closable) && (
          <View className="modal-header">
            <View className="modal-title">{title}</View>
            {closable && (
              <View className="modal-close" onClick={onClose}>
                ✕
              </View>
            )}
          </View>
        )}
        <ScrollView className="modal-body" scrollY>
          {children}
        </ScrollView>
        {footer && <View className="modal-footer">{footer}</View>}
      </View>
    </View>
  );
}
