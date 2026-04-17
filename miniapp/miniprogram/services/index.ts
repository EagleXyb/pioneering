import { API_ENDPOINTS } from '../../../shared/api/endpoints';
import { get, post, put } from '../utils/api';

export function fetchProfileByEmail(email: string) {
  return get(API_ENDPOINTS.PROFILE.BY_EMAIL(email));
}

export function upsertProfile(data: any) {
  return post(API_ENDPOINTS.PROFILE.UPSERT, data);
}

export function uploadAvatar(email: string, filePath: string) {
  const { uploadFile } = require('../utils/api');
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
