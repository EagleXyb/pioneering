export interface UserState {
  id: string;
  username: string;
  nickname: string;
  name: string; // 对外显示的昵称，兼容旧代码（由 nickname 填充）
  avatar: string | null;
  email: string | null;
  phone: string | null;
  isLoggedIn: boolean;
}