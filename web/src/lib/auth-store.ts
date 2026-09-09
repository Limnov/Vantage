/**
 * Auth Store (vanilla, no React dependencies)
 * ─────────────────────────────────────────────
 * 单一状态源 (Single Source of Truth)
 * - token / refreshToken / user / orgs / currentOrgId
 * - localStorage 持久化
 * - subscribe / notify 模式供 React 订阅
 * - refresh() 自动合并并发请求
 * - ensureFresh() 过期前 5 分钟主动刷新
 * - 跨标签页同步（storage 事件）
 *
 * 为什么不直接在 React 里管？
 * - axios 拦截器在 React 组件外执行，需要同步访问 token
 * - React 状态更新是异步的，拦截器读到旧值
 * - 拆成 vanilla store → 拦截器和 React 都从 store 拿最新值
 */

export interface User {
  id: number;
  username: string;
  email: string;
  display_name?: string;
  is_system_admin: boolean;
  is_demo?: boolean;
  is_trial?: boolean;
  trial?: {
    expires_at: string;
    allow_scheduled: boolean;
    allow_mcp: boolean;
    limits: { daily_agent_runs: number; daily_searches: number; max_watchlists: number };
    usage: { agent_runs: number; searches: number };
    remaining: { agent_runs: number; searches: number };
  };
}

export interface Org {
  id: number;
  name: string;
  slug: string;
  plan: string;
  my_role?: string;
  role?: string;
}

export interface AuthSnapshot {
  user: User | null;
  orgs: Org[];
  currentOrgId: number | null;
  currentOrg: Org | null;
  token: string | null;
  isAuthenticated: boolean;
}

const STORAGE_KEYS = {
  token: 'vantage.token',
  refresh: 'vantage.refresh',
  user: 'vantage.user',
  orgs: 'vantage.orgs',
  currentOrg: 'vantage.currentOrg'
} as const;

type Listener = () => void;
type RefreshApi = (refreshToken: string) => Promise<string>;
type AuthFailureHandler = () => void;

class AuthStore {
  // ── In-memory state ────────────────────────────────────────
  private _token: string | null = null;
  private _refreshToken: string | null = null;
  private _user: User | null = null;
  private _orgs: Org[] = [];
  private _currentOrgId: number | null = null;
  private _hydrated = false;

  // ── Subscribers ────────────────────────────────────────────
  private _listeners = new Set<Listener>();

  // ── Refresh machinery ──────────────────────────────────────
  private _refreshing: Promise<string | null> | null = null;
  private _refreshApi: RefreshApi | null = null;
  private _onAuthFailure: AuthFailureHandler | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Cached snapshot (for useSyncExternalStore) ─────────────
  private _snapshot: AuthSnapshot | null = null;

  // ═══════════════════════════════════════════════════════════
  //  Public getters
  // ═══════════════════════════════════════════════════════════

  get token(): string | null { return this._token; }
  get refreshToken(): string | null { return this._refreshToken; }
  get user(): User | null { return this._user; }
  get orgs(): Org[] { return this._orgs; }
  get currentOrgId(): number | null { return this._currentOrgId; }
  get currentOrg(): Org | null {
    return this._orgs.find(o => o.id === this._currentOrgId) || null;
  }
  get isAuthenticated(): boolean { return !!this._token; }
  get hydrated(): boolean { return this._hydrated; }

  /**
   * Stable snapshot reference (invalidated on every state change).
   * Required by useSyncExternalStore to avoid infinite re-renders.
   */
  getSnapshot(): AuthSnapshot {
    if (this._snapshot) return this._snapshot;
    this._snapshot = {
      user: this._user,
      orgs: this._orgs,
      currentOrgId: this._currentOrgId,
      currentOrg: this.currentOrg,
      token: this._token,
      isAuthenticated: this.isAuthenticated
    };
    return this._snapshot;
  }

  // ═══════════════════════════════════════════════════════════
  //  Subscriptions
  // ═══════════════════════════════════════════════════════════

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _emit(): void {
    this._snapshot = null; // invalidate cache
    this._listeners.forEach(fn => {
      try { fn(); } catch (err) { console.error('[auth-store] listener error:', err); }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Hydration (called once at app boot)
  // ═══════════════════════════════════════════════════════════

  hydrate(): void {
    if (this._hydrated) return;
    this._hydrated = true;

    try {
      const t = localStorage.getItem(STORAGE_KEYS.token);
      const rt = localStorage.getItem(STORAGE_KEYS.refresh);
      const u = localStorage.getItem(STORAGE_KEYS.user);
      const o = localStorage.getItem(STORAGE_KEYS.orgs);
      const co = localStorage.getItem(STORAGE_KEYS.currentOrg);

      if (t && u) {
        // token + user 都在，说明用户之前登录过
        this._token = t;
        this._refreshToken = rt;
        try { this._user = JSON.parse(u); } catch { this._user = null; }
        try { this._orgs = o ? JSON.parse(o) : []; } catch { this._orgs = []; }
        this._currentOrgId = co ? parseInt(co, 10) : (this._orgs[0]?.id || null);

        // 主动安排一次刷新检查
        this._scheduleProactiveRefresh();

        // 跨标签页同步：其他 tab 登出/登入时同步状态
        window.addEventListener('storage', this._onStorageChange);
      }
    } catch (err) {
      console.error('[auth-store] hydrate failed:', err);
      this._clear();
    }
    this._emit();
  }

  private _onStorageChange = (e: StorageEvent): void => {
    if (!e.key || Object.values(STORAGE_KEYS).includes(e.key as any)) {
      // 任意 auth 相关的 key 变化 → 重新读
      const hadToken = !!this._token;
      const hasTokenNow = !!localStorage.getItem(STORAGE_KEYS.token);

      if (hasTokenNow && !hadToken) {
        // 其他 tab 登入了 → hydrate
        this._hydrated = false;
        this.hydrate();
      } else if (!hasTokenNow && hadToken) {
        // 其他 tab 登出了 → 本 tab 也清空
        this._clear();
      }
    }
  };

  // ═══════════════════════════════════════════════════════════
  //  Setters (called from AuthProvider after login/logout)
  // ═══════════════════════════════════════════════════════════

  setAuth(data: {
    token: string;
    refreshToken: string;
    user: User;
    orgs: Org[];
    currentOrgId?: number | null;
  }): void {
    this._token = data.token;
    this._refreshToken = data.refreshToken;
    this._user = data.user;
    this._orgs = data.orgs || [];
    this._currentOrgId = data.currentOrgId ?? this._orgs[0]?.id ?? null;
    this._persist();
    this._scheduleProactiveRefresh();
    this._emit();
  }

  setUser(user: User): void {
    this._user = user;
    this._persist();
    this._emit();
  }

  setOrgs(orgs: Org[]): void {
    this._orgs = orgs || [];
    if (!this._currentOrgId || !this._orgs.find(o => o.id === this._currentOrgId)) {
      this._currentOrgId = this._orgs[0]?.id || null;
    }
    this._persist();
    this._emit();
  }

  switchOrg(orgId: number): void {
    this._currentOrgId = orgId;
    this._persist();
    this._emit();
  }

  /**
   * 替换当前 access token（不替换其他状态）
   * 用于 refresh 成功后只更新 token
   */
  setToken(newToken: string): void {
    this._token = newToken;
    this._persist();
    this._scheduleProactiveRefresh();
    this._emit();
  }

  clear(): void {
    this._clear();
  }

  // ═══════════════════════════════════════════════════════════
  //  Refresh machinery
  // ═══════════════════════════════════════════════════════════

  /**
   * 注册 refresh 函数（由 AuthProvider 调一次）
   * 把 HTTP 细节从 store 里解耦出去
   */
  registerRefreshHandler(
    refreshApi: RefreshApi,
    onAuthFailure: AuthFailureHandler
  ): void {
    this._refreshApi = refreshApi;
    this._onAuthFailure = onAuthFailure;
  }

  /**
   * 刷新 access token
   * - 多个并发调用共享同一个 refresh promise（coalesce）
   * - 失败时触发 onAuthFailure（一般是 toast + 登出）
   *
   * @returns 新 token，或 null（失败时）
   */
  async refresh(): Promise<string | null> {
    if (this._refreshing) {
      return this._refreshing;
    }
    if (!this._refreshToken) {
      this._handleAuthFailure();
      return null;
    }
    if (!this._refreshApi) {
      console.warn('[auth-store] refresh called but no refresh API registered');
      return null;
    }

    const rt = this._refreshToken;
    this._refreshing = (async () => {
      try {
        const newToken = await this._refreshApi!(rt);
        this.setToken(newToken); // 这里会触发 _emit
        return newToken;
      } catch (err) {
        console.warn('[auth-store] refresh failed:', err);
        this._handleAuthFailure();
        return null;
      } finally {
        this._refreshing = null;
      }
    })();

    return this._refreshing;
  }

  /**
   * 如果 token 即将过期（< 5 分钟），则主动刷新。
   * 在每个 API 请求前由 axios 拦截器调用。
   */
  async ensureFresh(): Promise<void> {
    if (!this._token) return;
    if (isTokenExpired(this._token)) {
      await this.refresh();
    }
  }

  private _scheduleProactiveRefresh(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (!this._token) return;

    const ms = msUntilExpiry(this._token);
    if (ms <= 0) {
      // 已过期 → 立即刷新
      this.refresh().catch(() => {});
      return;
    }
    // 在过期前 5 分钟刷新，但至少 30 秒后才执行
    const refreshIn = Math.max(ms - 5 * 60 * 1000, 30 * 1000);
    this._refreshTimer = setTimeout(() => {
      this.refresh().catch(() => {});
    }, refreshIn);
  }

  private _handleAuthFailure(): void {
    // 防止重复触发
    const wasAuthed = this.isAuthenticated;
    this._clear();
    if (wasAuthed && this._onAuthFailure) {
      // 推到下一帧，避免与当前调用栈冲突
      setTimeout(() => {
        try { this._onAuthFailure!(); } catch (err) { console.error(err); }
      }, 0);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Private
  // ═══════════════════════════════════════════════════════════

  private _clear(): void {
    this._token = null;
    this._refreshToken = null;
    this._user = null;
    this._orgs = [];
    this._currentOrgId = null;
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    window.removeEventListener('storage', this._onStorageChange);
    this._emit();
  }

  private _persist(): void {
    setOrRemove(STORAGE_KEYS.token, this._token);
    setOrRemove(STORAGE_KEYS.refresh, this._refreshToken);
    setOrRemove(STORAGE_KEYS.user, this._user ? JSON.stringify(this._user) : null);
    setOrRemove(STORAGE_KEYS.orgs, this._orgs.length ? JSON.stringify(this._orgs) : null);
    setOrRemove(STORAGE_KEYS.currentOrg, this._currentOrgId ? String(this._currentOrgId) : null);
  }
}

function setOrRemove(key: string, value: string | null): void {
  if (value === null || value === undefined) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, value);
  }
}

// ─── JWT helpers ──────────────────────────────────────────────

interface JwtPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  userId?: number;
  username?: string;
  type?: string;
}

/**
 * 解析 JWT payload，不依赖外部库
 * - 处理 base64url 编码（RFC 7515）
 * - 容错：token 格式不对时返回 null
 */
function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64
    const b64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    // 补齐 padding
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * token 是否在 5 分钟内过期
 */
function isTokenExpired(token: string): boolean {
  const payload = parseJwt(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 - Date.now() < 5 * 60 * 1000;
}

/**
 * 距离过期的毫秒数（最少 0）
 */
function msUntilExpiry(token: string): number {
  const payload = parseJwt(token);
  if (!payload?.exp) return 0;
  return Math.max(0, payload.exp * 1000 - Date.now());
}

// Singleton
export const authStore = new AuthStore();

// 暴露 JWT 工具供测试/调试用
export const __jwt = { parseJwt, isTokenExpired, msUntilExpiry };
