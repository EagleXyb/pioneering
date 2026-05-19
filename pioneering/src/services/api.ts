import { get, post, put, del, upload } from './request';

const API = {
  AUTH: {
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    PROFILE: '/api/auth/profile',
    REFRESH: '/api/auth/refresh',
  },
  AGENT: {
    CHAT: '/api/agent/chat',
    STREAM: '/api/agent/stream',
    SESSIONS: '/api/agent/sessions',
    SESSION_DETAIL: (id: string) => `/api/agent/sessions/${id}`,
    SESSION_MESSAGES: (id: string) => `/api/agent/sessions/${id}/messages`,
  },
  DISCOVER: {
    CASES: '/api/discover/cases',
    CASE_DETAIL: (id: string) => `/api/discover/cases/${id}`,
    TEMPLATES: '/api/discover/templates',
    RECOMMEND: '/api/discover/recommend',
  },
  PROFILE: {
    BY_EMAIL: (email: string) => `/api/profile/email/${email}`,
    UPSERT: '/api/profile/upsert',
    AVATAR: (email: string) => `/api/profile/avatar/${email}`,
  },
  UPLOAD: {
    IMAGE: '/api/upload/image',
    FILE: '/api/upload/file',
  },
};

export function login(data: { email: string; password: string }) {
  return post(API.AUTH.LOGIN, data);
}

export function fetchProfile() {
  return get(API.AUTH.PROFILE);
}

export function fetchProfileByEmail(email: string) {
  return get(API.PROFILE.BY_EMAIL(email));
}

export function upsertProfile(data: any) {
  return post(API.PROFILE.UPSERT, data);
}

export function uploadAvatar(email: string, filePath: string) {
  return upload(API.PROFILE.AVATAR(email), filePath, 'avatar');
}

export function sendChatMessage(sessionId: string, data: { content: string; mode?: string; model?: string }) {
  return post(API.AGENT.SESSION_MESSAGES(sessionId), data);
}

export function getSessions() {
  return get(API.AGENT.SESSIONS);
}

export function createSession(data: { title?: string; mode?: string }) {
  return post(API.AGENT.SESSIONS, data);
}

export function getSessionDetail(id: string) {
  return get(API.AGENT.SESSION_DETAIL(id));
}

export function getSessionMessages(id: string) {
  return get(API.AGENT.SESSION_MESSAGES(id));
}

export function getDiscoverCases(params?: { page?: number; pageSize?: number }) {
  return get(API.DISCOVER.CASES, params);
}

export function getDiscoverCaseDetail(id: string) {
  return get(API.DISCOVER.CASE_DETAIL(id));
}

export function getDiscoverTemplates() {
  return get(API.DISCOVER.TEMPLATES);
}

export function uploadImage(filePath: string) {
  return upload(API.UPLOAD.IMAGE, filePath, 'image');
}

export function uploadFile(filePath: string) {
  return upload(API.UPLOAD.FILE, filePath, 'file');
}

export default API;
