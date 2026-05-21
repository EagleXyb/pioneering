import { apiClient, API_BASE_URL } from './apiClient';
import { API_ENDPOINTS } from '../../../shared/api/endpoints';
import type { ProfileData, AIConfig, GlobalPrompt } from '../../../shared/types';

export const profileService = {
  getByEmail: (email: string) =>
    apiClient.get<ProfileData>(API_ENDPOINTS.PROFILE.BY_EMAIL(email)),

  upsert: (data: Partial<ProfileData>) =>
    apiClient.post<ProfileData>(API_ENDPOINTS.PROFILE.UPSERT, data),

  uploadAvatar: (email: string, file: FormData) =>
    fetch(`${API_BASE_URL}${API_ENDPOINTS.PROFILE.AVATAR(email)}`, {
      method: 'POST',
      body: file,
    }),
};

export const aiConfigService = {
  getLatest: () =>
    apiClient.get<AIConfig>(API_ENDPOINTS.AI_CONFIG.LATEST),

  test: (data: { apiKey: string; provider: string; model: string }) =>
    apiClient.post(API_ENDPOINTS.AI_CONFIG.TEST, data),

  save: (data: AIConfig) =>
    apiClient.post(API_ENDPOINTS.AI_CONFIG.SAVE, data),
};

export const globalPromptService = {
  getOnline: () =>
    apiClient.get<GlobalPrompt | null>(API_ENDPOINTS.GLOBAL_PROMPT.ONLINE),

  getAll: () =>
    apiClient.get<GlobalPrompt[]>(API_ENDPOINTS.GLOBAL_PROMPT.BASE),

  create: (data: any) =>
    apiClient.post<GlobalPrompt>(API_ENDPOINTS.GLOBAL_PROMPT.BASE, data),

  update: (id: number, data: any) =>
    apiClient.put<GlobalPrompt>(API_ENDPOINTS.GLOBAL_PROMPT.BY_ID(id), data),
};
