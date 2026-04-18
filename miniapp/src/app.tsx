import { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { useAppStore } from './store';
import './app.scss';

function App({ children }: { children?: React.ReactNode }) {
  const setLoggedIn = useAppStore((state) => state.setLoggedIn);
  const setUserInfo = useAppStore((state) => state.setUserInfo);

  useEffect(() => {
    const token = Taro.getStorageSync('token');
    if (token) {
      setLoggedIn(true);
      const userInfo = Taro.getStorageSync('userInfo');
      if (userInfo) {
        try {
          setUserInfo(JSON.parse(userInfo));
        } catch {
          // ignore
        }
      }
    }
  }, [setLoggedIn, setUserInfo]);

  return <>{children}</>;
}

export default App;
