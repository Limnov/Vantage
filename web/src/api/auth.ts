/**
 * Auth API
 * ─────────────────────────────────────────────
 * 登录 / 注册 / 刷新 / me / 登出 / 改密
 *
 * 这些端点走 auth-bypass 模式（__skipAuth: true），
 * 不会触发 token 注入（避免循环）
 */

import api from './client';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  user: {
    id: number;
    username: string;
    email: string;
    display_name?: string;
    is_system_admin: boolean;
  is_demo?: boolean;
  };
  orgs: Array<{
    id: number;
    name: string;
    slug: string;
    plan: string;
    my_role?: string;
  }>;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  display_name?: string;
  orgName?: string;
  orgSlug?: string;
}

export interface RegisterResponse {
  token: string;
  refreshToken: string;
  user: LoginResponse['user'];
  org?: {
    id: number;
    name: string;
    slug: string;
    role: string;
  };
}

export interface MeResponse {
  user: LoginResponse['user'];
  orgs: LoginResponse['orgs'];
}

export interface RefreshResponse {
  token: string;
}

export const authApi = {
  registration: () =>
    api
      .get<{ enabled: boolean }>('/auth/registration', { __skipAuth: true })
      .then((r) => r.data),

  login: (username: string, password: string) =>
    api
      .post<LoginResponse>('/auth/login', { username, password }, { __skipAuth: true })
      .then((r) => r.data),

  register: (data: RegisterRequest) =>
    api
      .post<RegisterResponse>('/auth/register', data, { __skipAuth: true })
      .then((r) => r.data),

  me: () => api.get<MeResponse>('/auth/me').then((r) => r.data),

  refresh: (refreshToken: string) =>
    api
      .post<RefreshResponse>('/auth/refresh', { refreshToken }, { __skipAuth: true })
      .then((r) => r.data),

  logout: () => api.post<{ ok: boolean }>('/auth/logout').then((r) => r.data),

  changePassword: (oldPassword: string, newPassword: string) =>
    api
      .post<{ ok: boolean }>(
        '/auth/change-password',
        { oldPassword, newPassword }
      )
      .then((r) => r.data)
};
