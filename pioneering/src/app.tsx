import { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { useAppStore } from './store';
import './styles/global.scss';

function App({ children }: { children?: React.ReactNode }) {
  const setSystemInfo = useAppStore((s) => s.setSystemInfo);

  useEffect(() => {
    try {
      const sysInfo = Taro.getSystemInfoSync();
      setSystemInfo({
        statusBarHeight: sysInfo.statusBarHeight || 0,
        navBarHeight: (sysInfo.statusBarHeight || 0) + 44,
        windowHeight: sysInfo.windowHeight,
        windowWidth: sysInfo.windowWidth,
        platform: sysInfo.platform || '',
      });
    } catch {
      // ignore
    }
  }, [setSystemInfo]);

  return <>{children}</>;
}

export default App;
