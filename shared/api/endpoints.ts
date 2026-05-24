export const API_ENDPOINTS = {
  // Auth
  AUTH: {
    LOGIN: '/auth/login',
    REFRESH: '/auth/refresh',
  },

  // User / Profile
  PROFILE: {
    BASE: '/user/profile',
    BY_ID: (id: string) => `/user/profile/${id}`,
    QUOTA: '/user/quota',
    QUOTA_USAGE: '/user/quota/usage',
  },

  // AI Config（admin：需后端实现，当前前端使用 localStorage 兜底）
  AI_CONFIG: {
    BASE: '/ai-config',
    BY_ID: (id: number) => `/ai-config/${id}`,
    LATEST: '/ai-config/latest',
    TEST: '/ai-config/test',
    SAVE: '/ai-config/save',
    BY_PROVIDER_MODEL: (provider: string, model: string) =>
      `/ai-config/provider/${provider}/model/${model}`,
  },

  // Global Prompt（admin：需后端实现）
  GLOBAL_PROMPT: {
    BASE: '/api/global-prompt',
    BY_ID: (id: number) => `/api/global-prompt/${id}`,
    BY_NAME: (name: string) => `/api/global-prompt/name/${encodeURIComponent(name)}`,
    ONLINE: '/api/global-prompt/online',
    STATUS: (id: number) => `/api/global-prompt/${id}/status`,
    APPROVAL: (id: number) => `/api/global-prompt/${id}/approval`,
  },

  // Chat
  CHAT: {
    SESSIONS: '/chat/sessions',
    SESSION_BY_ID: (id: string) => `/chat/sessions/${id}`,
    MESSAGES: (sessionId: string) => `/chat/sessions/${sessionId}/messages`,
    MESSAGE_BY_ID: (sessionId: string, msgId: string) => `/chat/sessions/${sessionId}/messages/${msgId}`,
    COMPLETIONS: '/chat/completions',
    COMPLETIONS_STOP: '/chat/completions/stop',
    FEEDBACK: (messageId: string) => `/chat/messages/${messageId}/feedback`,
    REGENERATE: (messageId: string) => `/chat/messages/${messageId}/regenerate`,
  },

  // System
  SYSTEM: {
    MODELS: '/system/models',
    CONFIG: '/system/config',
  },

  // Health
  HEALTH: '/health',

  // Upload
  UPLOAD: '/upload',
  UPLOAD_BY_ID: (fileId: string) => `/upload/${fileId}`,
} as const;
