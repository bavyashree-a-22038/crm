import { apiRequest } from './api.js';

export function getAuthStatus() {
  return apiRequest('/api/auth/status');
}

export function getCurrentUser() {
  return apiRequest('/api/auth/me');
}

export async function logout() {
  await apiRequest('/api/auth/logout', { method: 'POST' });
}
