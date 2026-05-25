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
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  syncUserInfo: () => Promise<void>;
  getToken: () => string | null;
}

const defaultUserState: UserState = {
  id: '',
  username: '',
  nickname: '',
  name: '',
  avatar: null,
  email: null,
  phone: null,
  isLoggedIn: false,
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userState, setUserState] = useState<UserState>(() => {
    try {
      const saved = localStorage.getItem('userState');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return defaultUserState;
  });

  // 持久化到 localStorage
  useEffect(() => {
    if (userState.isLoggedIn) {
      localStorage.setItem('userState', JSON.stringify(userState));
    } else {
      localStorage.removeItem('userState');
    }
  }, [userState]);

  // 登录后自动同步用户信息
  useEffect(() => {
    if (userState.isLoggedIn) {
      syncUserInfo();
    }
  }, [userState.isLoggedIn]);

  const getToken = (): string | null => {
    return localStorage.getItem('token');
  };

  // ========== 同步用户信息（从后端拉取最新 profile） ==========
  const syncUserInfo = async () => {
    const token = getToken();
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.PROFILE.BASE}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const result = await response.json();
        const data = result.data || result;
        if (data) {
          setUserState(prev => ({
            ...prev,
            id: data.id || prev.id,
            username: data.username || prev.username,
            nickname: data.nickname || prev.nickname,
            name: data.nickname || data.username || prev.name,
            avatar: data.avatar || null,
            email: data.email || null,
            phone: data.phone || null,
          }));
        }
      }
    } catch (error) {
      console.error('同步用户信息失败:', error);
    }
  };

  // ========== 登录 ==========
  const login = async (username: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.LOGIN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: '登录失败' }));
      throw new Error(error.message || `登录失败 (${response.status})`);
    }

    const result = await response.json();
    // 兼容统一响应格式 { code, data, message } 和旧版直接返回
    const payload = result.data || result;
    const { token, refreshToken, user } = payload;

    // 存储 token
    localStorage.setItem('token', token);
    localStorage.setItem('refreshToken', refreshToken);

    // 更新用户状态
    setUserState({
      id: user.id || '',
      username: user.username || username,
      nickname: user.nickname || '',
      name: user.nickname || user.username || username,
      avatar: user.avatar || null,
      email: user.email || null,
      phone: user.phone || null,
      isLoggedIn: true,
    });
  };

  // ========== 退出登录 ==========
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userState');
    setUserState(defaultUserState);
  };

  // ========== 便捷 setter（兼容旧代码） ==========
  const setAvatar = (avatar: string | null) => {
    setUserState(prev => ({ ...prev, avatar }));
  };

  const setName = (name: string) => {
    setUserState(prev => ({ ...prev, name, nickname: name }));
  };

  const setEmail = (email: string) => {
    setUserState(prev => ({ ...prev, email }));
  };

  const setIsLoggedIn = (isLoggedIn: boolean) => {
    if (!isLoggedIn) {
      logout();
    } else {
      setUserState(prev => ({ ...prev, isLoggedIn: true }));
    }
  };

  return (
    <UserContext.Provider
      value={{
        userState,
        setAvatar,
        setName,
        setEmail,
        setIsLoggedIn,
        login,
        logout,
        syncUserInfo,
        getToken,
      }}
    >
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