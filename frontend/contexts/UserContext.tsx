import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface UserState {
  avatar: string | null;
  name: string;
  email: string;
}

interface UserContextType {
  userState: UserState;
  setAvatar: (avatar: string | null) => void;
  setName: (name: string) => void;
  setEmail: (email: string) => void;
  syncAvatarFromDatabase: () => Promise<void>;
}

const defaultUserState: UserState = {
  avatar: null,
  name: '张三',
  email: 'zhangsan@example.com',
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userState, setUserState] = useState<UserState>(() => {
    try {
      // 从 localStorage 读取保存的用户信息
      const savedState = localStorage.getItem('userState');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        return parsed;
      }
      return defaultUserState;
    } catch (error) {
      console.error('读取用户状态失败:', error);
      return defaultUserState;
    }
  });

  // 保存到 localStorage
  useEffect(() => {
    try {
      const serialized = JSON.stringify(userState);
      localStorage.setItem('userState', serialized);
    } catch (error) {
      console.error('保存用户状态失败:', error);
      // 如果存储失败，尝试清除旧数据
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.warn('localStorage 空间不足，清除头像数据');
        const { avatar, ...rest } = userState;
        localStorage.setItem('userState', JSON.stringify(rest));
      }
    }
  }, [userState]);

  // 从数据库同步头像
  const syncAvatarFromDatabase = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/profile/email/zhangsan@example.com');
      if (response.ok) {
        const data = await response.json();
        if (data && data.avatar) {
          setUserState(prev => ({ ...prev, avatar: data.avatar }));
        }
      }
    } catch (error) {
      console.error('同步头像失败:', error);
    }
  };

  const setAvatar = (avatar: string | null) => {
    try {
      setUserState(prev => ({ ...prev, avatar }));
    } catch (error) {
      console.error('设置头像失败:', error);
    }
  };

  const setName = (name: string) => {
    setUserState(prev => ({ ...prev, name }));
  };

  const setEmail = (email: string) => {
    setUserState(prev => ({ ...prev, email }));
  };

  return (
    <UserContext.Provider value={{ userState, setAvatar, setName, setEmail, syncAvatarFromDatabase }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = (): UserContextType => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
