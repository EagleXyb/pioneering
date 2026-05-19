import Taro from '@tarojs/taro';
import { useState, useCallback } from 'react';

export function useStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = Taro.getStorageSync(key);
      return item !== '' ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      try {
        Taro.setStorageSync(key, JSON.stringify(valueToStore));
      } catch {
        // ignore
      }
    },
    [key, storedValue],
  );

  const removeValue = useCallback(() => {
    try {
      Taro.removeStorageSync(key);
      setStoredValue(initialValue);
    } catch {
      // ignore
    }
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue] as const;
}
