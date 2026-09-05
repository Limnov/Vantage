/**
 * Vantage API - 统一 axios 客户端
 * ─────────────────────────────────────────────
 * 唯一 axios 实例（避免多实例状态不同步问题）
 *
 * 拦截器职责：
 *  1. request: 从 authStore 同步读取 token / orgId，注入 header
 *               自动调用 ensureFresh() 主动刷新即将过期的 token
 *  2. response: 401 → 合并刷新 → 重放请求
 *               错误统一 toast
 *
 * 自定义 config 字段（TypeScript 增强见底部）：
 *  - __skipAuth: true → 跳过 token 注入（用于登录/注册/刷新本身）
 *  - __isRetry: true → 标记为重放请求，避免 401 死循环
 *  - __silent: true → 不显示错误 toast
 *
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { authStore } from '../lib/auth-store';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

// ═══════════════════════════════════════════════════════════
//  Request interceptor
// ═══════════════════════════════════════════════════════════

api.interceptors.request.use(async (config) => {
  // 跳过 auth 的请求（登录/注册/刷新自己）直接发
  if (config.__skipAuth) {
    return config;
  }

  // 主动刷新即将过期的 token
  await authStore.ensureFresh();

  const token = authStore.token;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  const orgId = authStore.currentOrgId;
  if (orgId && !config.headers.has('X-Org-Id')) {
    config.headers.set('X-Org-Id', String(orgId));
  }
  return config;
});

// ═══════════════════════════════════════════════════════════
//  Response interceptor
// ═══════════════════════════════════════════════════════════

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const status = err.response?.status;
    const original = err.config as InternalAxiosRequestConfig & { __isRetry?: boolean };

    // 401 自动刷新 + 重放
    // 条件：有 token（不是登录/注册），且未重放过
    if (status === 401 && authStore.token && !original.__isRetry) {
      original.__isRetry = true;
      const newToken = await authStore.refresh();
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return api.request(original);
      }
      // refresh 失败 → authStore 已清空 + 已通知 onAuthFailure
      // 继续走错误处理，让调用方看到错误
    }

    // 错误 toast
    // - 401 已处理，不重复提示
    // - 404 太常见，不打扰
    // - __silent 让单个请求可以静默
    if (!original?.__silent && status && status !== 401 && status !== 404) {
      const data = err.response?.data as { error?: string } | undefined;
      const msg = data?.error || err.message || '请求失败';
      message.error(msg);
    }

    return Promise.reject(err);
  }
);

// ═══════════════════════════════════════════════════════════
//  TypeScript augmentations
// ═══════════════════════════════════════════════════════════

declare module 'axios' {
  export interface AxiosRequestConfig {
    __skipAuth?: boolean;
    __isRetry?: boolean;
    __silent?: boolean;
  }
  export interface InternalAxiosRequestConfig {
    __skipAuth?: boolean;
    __isRetry?: boolean;
    __silent?: boolean;
  }
}

export default api;
