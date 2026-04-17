import { createContext, useContext } from 'react';
import type { UserState } from '../../../shared/types';

interface UserContextType {
  userState: UserState;
  login: (email: string, name?: string) => Promise<void>;
  logout: () => void;
  setAvatar: (avatar: string | null) => void;
}

const defaultUserState: UserState = {
  avatar: null,
  name: '张三',
  email: 'zhangsan@example.com',
  isLoggedIn: false,
};

const UserContext = createContext<UserContextType>({
  userState: defaultUserState,
  login: async () => {},
  logout: () => {},
  setAvatar: () => {},
});

export const useUser = () => useContext(UserContext);
export { UserContext, defaultUserState };
