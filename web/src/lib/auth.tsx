/**
 * AuthProvider + useAuth
 * ─────────────────────────────────────────────
 * authStore 的薄 React 封装
 * - 用 useSyncExternalStore 订阅 store 变化
 * - 提供 login/register/logout 等副作用友好的方法
 * - 所有 token/状态管理都委托给 authStore
 */

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { message } from 'antd';
import { authStore, User, Org, AuthSnapshot } from './auth-store';
import { authApi } from '../api/auth';

interface AuthContextValue extends AuthSnapshot {
  /** 初始 hydrate 是否完成 */
  loading: boolean;

  // ─── Actions ──────────────────────────────────────────────
  login: (username: string, password: string) => Promise<void>;
  register: (data: {
    username: string;
    email: string;
    password: string;
    display_name?: string;
    orgName?: string;
    orgSlug?: string;
  }) => Promise<void>;
  logout: () => void;
  switchOrg: (orgId: number) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);

  // ── Hydrate once on mount ─────────────────────────────────
  useEffect(() => {
    authStore.hydrate();
    setLoading(false);
  }, []);

  // ── Register refresh handler once ─────────────────────────
  useEffect(() => {
    authStore.registerRefreshHandler(
      async (rt) => {
        const r = await authApi.refresh(rt);
        return r.token;
      },
      () => {
        // 静默通知：用户不必被打断
        // 真正的 logout 由调用方决定
        message.warning('登录已过期，请重新登录', 2);
      }
    );
  }, []);

  // ── Subscribe to store (reactive snapshot) ────────────────
  const snapshot = useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.getSnapshot(),
    () => authStore.getSnapshot()
  );

  // ── Actions ───────────────────────────────────────────────
  const login = async (username: string, password: string): Promise<void> => {
    const r = await authApi.login(username, password);
    authStore.setAuth({
      token: r.token,
      refreshToken: r.refreshToken,
      user: r.user as User,
      orgs: r.orgs as Org[]
    });
    message.success(`欢迎回来，${r.user.display_name || r.user.username}`);
  };

  const register = async (data: {
    username: string;
    email: string;
    password: string;
    display_name?: string;
    orgName?: string;
    orgSlug?: string;
  }): Promise<void> => {
    const r = await authApi.register(data);
    // 注册响应已包含新组织；先建立认证状态，避免未登录调用 me。
    authStore.setAuth({
      token: r.token,
      refreshToken: r.refreshToken,
      user: r.user as User,
      orgs: r.org ? [r.org as Org] : []
    });
    message.success('注册成功！');
  };

  const logout = (): void => {
    // 异步登出（best effort，失败也不阻塞）
    authApi.logout().catch(() => {});
    authStore.clear();
    message.success('已退出登录');
  };

  const switchOrg = (orgId: number): void => {
    authStore.switchOrg(orgId);
    const org = authStore.currentOrg;
    if (org) {
      message.info(`已切换到「${org.name}」`);
    }
  };

  const refresh = async (): Promise<void> => {
    const newToken = await authStore.refresh();
    if (!newToken) {
      throw new Error('refresh failed');
    }
  };

  const value: AuthContextValue = {
    ...snapshot,
    loading,
    login,
    register,
    logout,
    switchOrg,
    refresh
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
