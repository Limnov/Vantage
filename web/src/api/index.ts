/**
 * Vantage API - Business endpoints
 * All endpoints go through unified axios client (./client),
 * auto-attaching token / X-Org-Id, auto-handling 401 refresh.
 */

import api from './client';
import { authStore } from '../lib/auth-store';

// --- Watchlist ---
export const watchlistApi = {
  list: (params?: any) => api.get('/watchlist', { params }).then((r) => r.data),
  get: (id: number) => api.get(`/watchlist/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/watchlist', data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/watchlist/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/watchlist/${id}`).then((r) => r.data),
  run: (id: number) => api.post(`/watchlist/${id}/run`).then((r) => r.data),
  runAll: () => api.post('/watchlist/run-all').then((r) => r.data)
};

// --- Search ---
export const searchApi = {
  global: (q: string) => api.get('/search/global', { params: { q } }).then((r) => r.data)
};

// --- Reports ---
export const reportsApi = {
  list: (params?: any) => api.get('/reports', { params }).then((r) => r.data),
  get: (id: number) => api.get(`/reports/${id}`).then((r) => r.data),
  push: (id: number) => api.post(`/reports/${id}/push`).then((r) => r.data),
  export: (id: number, format: 'md' | 'json' = 'md') => {
    window.open(`/api/reports/${id}/export?format=${format}`, '_blank');
  },
  stats: () => api.get('/reports/stats/summary').then((r) => r.data)
};

// --- Agent 工作台 ---
export const agentApi = {
  list: (params?: { status?: string; agent?: string; conversation?: string; limit?: number; offset?: number }) =>
    api.get('/agent/runs', { params }).then((r) => r.data),
  start: (data: { goal: string; watchlistId?: number; agent?: string; conversationId?: string }) =>
    api.post('/agent/runs', data).then((r) => r.data),
  get: (id: string) => api.get(`/agent/runs/${id}`).then((r) => r.data),
  cancel: (id: string) => api.post(`/agent/runs/${id}/cancel`).then((r) => r.data),
  approve: (runId: string, actionId: string) =>
    api.post(`/agent/runs/${runId}/actions/${actionId}/approve`).then((r) => r.data),
  reject: (runId: string, actionId: string, reason?: string) =>
    api.post(`/agent/runs/${runId}/actions/${actionId}/reject`, { reason }).then((r) => r.data)
};

// --- Alerts ---
export const alertsApi = {
  list: (params?: any) => api.get('/alerts', { params }).then((r) => r.data),
  ack: (id: number) => api.post(`/alerts/${id}/ack`).then((r) => r.data),
  dismiss: (id: number) => api.post(`/alerts/${id}/dismiss`).then((r) => r.data),
  resend: (id: number) => api.post(`/alerts/${id}/resend`).then((r) => r.data)
};

// --- Dashboard ---
export const dashboardApi = {
  get: () => api.get('/dashboard').then((r) => r.data),
  health: () => api.get('/dashboard/health').then((r) => r.data),
  timeseries: () => api.get('/dashboard/timeseries').then((r) => r.data)
};

// --- Settings ---
export const settingsApi = {
  list: () => api.get('/settings').then((r) => r.data),
  get: (key: string) => api.get(`/settings/${key}`).then((r) => r.data),
  update: (key: string, value: any, description?: string, scope?: string) =>
    api.put(`/settings/${key}`, { value, description, scope }).then((r) => r.data)
};

// --- AI Models ---
export const aiApi = {
  getModels: () => api.get('/ai/models').then((r) => r.data),
  getConfig: () => api.get('/ai/config').then((r) => r.data),
  saveConfig: (provider: string, data: any) =>
    api.put('/ai/config', { provider, ...data }).then((r) => r.data),
  fetchModels: (provider: string) =>
    api.get(`/ai/fetch-models/${provider}`).then((r) => r.data),
  test: (provider: string, model?: string) =>
    api.post('/ai/test', { provider, model }).then((r) => r.data),
  getStatus: () => api.get('/ai/status').then((r) => r.data)
};

// --- Organizations ---
export const orgsApi = {
  list: () => api.get('/orgs').then((r) => r.data),
  get: (id: number) => api.get(`/orgs/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/orgs', data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/orgs/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/orgs/${id}`).then((r) => r.data)
};

// --- Members ---
export const membersApi = {
  list: (orgId: number) => api.get('/members', { params: { orgId } }).then((r) => r.data),
  add: (orgId: number, userId: number, role: string) =>
    api.post('/members', { orgId, userId, role }).then((r) => r.data),
  inviteAndCreate: (data: any) =>
    api.post('/members/invite-and-create', data).then((r) => r.data),
  searchUsers: (q: string) =>
    api.get('/members/search-users', { params: { q } }).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/members/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/members/${id}`).then((r) => r.data)
};

// --- Bots ---
export const botsApi = {
  list: (orgId: number) => api.get('/bots', { params: { orgId } }).then((r) => r.data),
  get: (id: number) => api.get(`/bots/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/bots', data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/bots/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/bots/${id}`).then((r) => r.data),
  test: (id: number, message?: string) =>
    api.post(`/bots/${id}/test`, { message }).then((r) => r.data)
};

// --- Alert Routes ---
export const alertRoutesApi = {
  list: (orgId: number) => api.get('/routes', { params: { orgId } }).then((r) => r.data),
  create: (data: any) => api.post('/routes', data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/routes/${id}`, data).then((r) => r.data),
  remove: (id: number) => api.delete(`/routes/${id}`).then((r) => r.data)
};

// --- Logs ---
export const logsApi = {
  list: (params?: any) => api.get('/logs', { params }).then((r) => r.data),
  stats: () => api.get('/logs/stats').then((r) => r.data),
  clear: () => api.delete('/logs').then((r) => r.data)
};

// --- Tavily ---
export const tavilyApi = {
  getConfig: () => api.get('/tavily/config').then((r) => r.data),
  saveConfig: (apiKey: string) => api.put('/tavily/config', { apiKey }).then((r) => r.data),
  test: () => api.post('/tavily/test').then((r) => r.data)
};

// --- 本地运行时配置（不写入 SQLite） ---
export const runtimeConfigApi = {
  get: () => api.get('/runtime-config').then((r) => r.data),
  update: (values: Record<string, string | number | boolean | null>) =>
    api.put('/runtime-config', { values }).then((r) => r.data)
};

/**
 * SSE 流式读取某个 Agent 任务的执行过程。
 * 用 fetch 手动解析 event-stream（EventSource 无法携带 Authorization 头）。
 * 服务端每 800ms 检查一次变化，任务进入终态后发送 done 并关闭。
 */
export async function streamAgentRun(
  runId: string,
  onUpdate: (run: any) => void,
  signal?: AbortSignal
): Promise<void> {
  await authStore.ensureFresh();
  const token = authStore.token;
  const orgId = authStore.currentOrgId;
  const base = (import.meta as any).env?.VITE_API_BASE || '/api';
  const res = await fetch(`${base}/agent/runs/${runId}/events`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
      Accept: 'text/event-stream'
    },
    signal
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handlePayload = (payload: string) => {
    if (!payload || payload === '[done]') return;
    try { onUpdate(JSON.parse(payload)); } catch { /* ignore malformed */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (line.startsWith('data:')) handlePayload(line.slice(5).trim());
      }
    }
  }
}

// --- Re-exports ---
export { authApi } from './auth';
export { default as api } from './client';
export { authStore } from '../lib/auth-store';
