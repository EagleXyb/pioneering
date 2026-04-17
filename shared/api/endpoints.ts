export const API_ENDPOINTS = {
  PROFILE: {
    BASE: '/api/profile',
    BY_ID: (id: number) => `/api/profile/${id}`,
    BY_EMAIL: (email: string) => `/api/profile/email/${email}`,
    UPSERT: '/api/profile/upsert',
    AVATAR: (email: string) => `/api/profile/avatar/${email}`,
  },
  AI_CONFIG: {
    BASE: '/ai-config',
    BY_ID: (id: number) => `/ai-config/${id}`,
    LATEST: '/ai-config/latest',
    TEST: '/ai-config/test',
    SAVE: '/ai-config/save',
    BY_PROVIDER_MODEL: (provider: string, model: string) =>
      `/ai-config/provider/${provider}/model/${model}`,
  },
  GLOBAL_PROMPT: {
    BASE: '/api/global-prompt',
    BY_ID: (id: number) => `/api/global-prompt/${id}`,
    BY_NAME: (name: string) => `/api/global-prompt/name/${encodeURIComponent(name)}`,
    ONLINE: '/api/global-prompt/online',
    STATUS: (id: number) => `/api/global-prompt/${id}/status`,
    APPROVAL: (id: number) => `/api/global-prompt/${id}/approval`,
  },
} as const;
