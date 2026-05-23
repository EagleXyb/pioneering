import { useState, useEffect, useMemo } from 'react';
import Taro from '@tarojs/taro';

export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    let lastHeight = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleKeyboardChange = (res: { height: number }) => {
      if (Math.abs(res.height - lastHeight) > 10) {
        lastHeight = res.height;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          setKeyboardHeight(res.height);
          setIsKeyboardVisible(res.height > 0);
        }, 50);
      }
    };

    try {
      Taro.onKeyboardHeightChange(handleKeyboardChange);
      return () => {
        if (timer) clearTimeout(timer);
        Taro.offKeyboardHeightChange(handleKeyboardChange);
      };
    } catch (e) {
      console.warn('键盘高度监听不支持:', e);
    }
  }, []);

  const bottomAreaStyle = useMemo(() => {
    if (isKeyboardVisible && keyboardHeight > 0) {
      try {
        const sysInfo = Taro.getSystemInfoSync();
        const safeAreaBottom = sysInfo.safeArea?.bottom || sysInfo.windowHeight;
        const screenHeight = sysInfo.screenHeight || sysInfo.windowHeight;
        const safeBottomInset = screenHeight - safeAreaBottom;
        const totalPadding = keyboardHeight + Math.max(safeBottomInset, 0);

        return {
          paddingBottom: `${totalPadding}px`,
          transition: 'padding-bottom 0.25s ease',
          transform: 'translateZ(0)',
        };
      } catch {
        return {
          paddingBottom: `${keyboardHeight}px`,
          transition: 'padding-bottom 0.25s ease',
          transform: 'translateZ(0)',
        };
      }
    }
    return {};
  }, [isKeyboardVisible, keyboardHeight]);

  return { keyboardHeight, isKeyboardVisible, bottomAreaStyle };
}
