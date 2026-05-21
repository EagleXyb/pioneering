import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { UserState } from '@shared/types/user';
import { API_ENDPOINTS } from '@shared/api/endpoints';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface UserContextType {
  userState: UserState;
  setAvatar: (avatar: string | null) => void;
  setName: (name: string) => void;
  setEmail: (email: string) => void;
  setIsLoggedIn: (isLoggedIn: boolean) => void;
  login: (email: string, name?: string) => Promise<void>;
  logout: () => void;
  syncUserInfo: () => Promise<void>;
}

const defaultUserState: UserState = {
  avatar: null,
  name: '张三',
  email: 'zhangsan@example.com',
  isLoggedIn: false,
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userState, setUserState] = useState<UserState>(() => {
    try {
      const savedState = localStorage.getItem('userState');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        return {
          ...defaultUserState,
          ...parsed,
          avatar: null,
        };
      }
      return defaultUserState;
    } catch (error) {
      console.error('读取用户状态失败:', error);
      return defaultUserState;
    }
  });

  useEffect(() => {
    try {
      const { avatar, ...stateToSave } = userState;
      localStorage.setItem('userState', JSON.stringify(stateToSave));
    } catch (error) {
      console.error('保存用户状态失败:', error);
    }
  }, [userState]);

  useEffect(() => {
    if (userState.isLoggedIn && userState.email) {
      syncUserInfo();
    }
  }, [userState.isLoggedIn, userState.email]);

  const syncUserInfo = async () => {
    if (!userState.email) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.PROFILE.BY_EMAIL(userState.email)}`);
      if (response.ok) {
        const text = await response.text();
        if (text) {
          try {
            const data = JSON.parse(text);
            if (data) {
              setUserState(prev => ({
                ...prev,
                avatar: data.avatar || null,
                name: data.name || prev.name,
              }));
            }
          } catch (parseError) {
            console.warn('解析用户信息失败:', parseError);
          }
        }
      }
    } catch (error) {
      console.error('同步用户信息失败:', error);
    }
  };

  const login = async (email: string, name?: string) => {
    setUserState(prev => ({
      ...prev,
      email,
      name: name || prev.name,
      isLoggedIn: true,
    }));
  };

  const logout = () => {
    setUserState(prev => ({
      ...prev,
      isLoggedIn: false,
      avatar: null,
    }));
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

  const setIsLoggedIn = (isLoggedIn: boolean) => {
    setUserState(prev => ({ ...prev, isLoggedIn }));
  };

  return (
    <UserContext.Provider value={{ 
      userState, 
      setAvatar, 
      setName, 
      setEmail, 
      setIsLoggedIn,
      login,
      logout,
      syncUserInfo 
    }}>
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
