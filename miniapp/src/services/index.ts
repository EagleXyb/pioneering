import { get, post, uploadFile } from './api';

const API_ENDPOINTS = {
  PROFILE: {
    BY_EMAIL: (email: string) => `/api/profile/email/${email}`,
    UPSERT: '/api/profile/upsert',
    AVATAR: (email: string) => `/api/profile/avatar/${email}`,
  },
  AI_CONFIG: {
    LATEST: '/api/ai-config/latest',
    TEST: '/api/ai-config/test',
    SAVE: '/api/ai-config/save',
  },
  GLOBAL_PROMPT: {
    ONLINE: '/api/global-prompt/online',
  },
};

export function fetchProfileByEmail(email: string) {
  return get(API_ENDPOINTS.PROFILE.BY_EMAIL(email));
}

export function upsertProfile(data: any) {
  return post(API_ENDPOINTS.PROFILE.UPSERT, data);
}

export function uploadAvatar(email: string, filePath: string) {
  return uploadFile(API_ENDPOINTS.PROFILE.AVATAR(email), filePath, 'avatar');
}

export function fetchAIConfig() {
  return get(API_ENDPOINTS.AI_CONFIG.LATEST);
}

export function testConnection(data: any) {
  return post(API_ENDPOINTS.AI_CONFIG.TEST, data);
}

export function saveAIConfig(data: any) {
  return post(API_ENDPOINTS.AI_CONFIG.SAVE, data);
}

export function fetchOnlinePrompt() {
  return get(API_ENDPOINTS.GLOBAL_PROMPT.ONLINE);
}
