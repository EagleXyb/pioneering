import { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { useAppStore } from './store';
import { ensureLogin } from './services/auth';
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

    // 应用启动时静默登录
    ensureLogin();
  }, [setSystemInfo]);

  return <>{children}</>;
}

export default App;
