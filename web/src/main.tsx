import React, { useState, useEffect, lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { ConfigProvider, theme, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider, useAuth } from './lib/auth';
import 'antd/dist/reset.css';
import './index.css';

const Landing = lazy(() => import('./pages/Landing'));
const Evidence = lazy(() => import('./pages/Evidence'));
const Login = lazy(() => import('./pages/Login'));
const UnifiedApp = lazy(() => import('./UnifiedApp'));


function Entry({mode,toggleTheme}: {mode: ThemeMode; toggleTheme: () => void}) {
  const {pathname} = useLocation();
  useEffect(() => {
    document.title = pathname === '/' ? 'Vantage 跨境市场情报 Agent 工作台' : pathname === '/demo' ? 'Vantage Demo 真实工作台' : pathname === '/evidence' ? 'Vantage 真实案例与评测' : 'Vantage 工作台';
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://vantage.limnov.com${pathname}`);
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.setAttribute('name','robots'); document.head.appendChild(robots); }
    robots.setAttribute('content', pathname === '/' || pathname === '/demo' ? 'index,follow' : 'noindex,nofollow');
  }, [pathname]);
  if (pathname === '/') return <Suspense fallback={<div className="mode-loading">加载中…</div>}><Landing/></Suspense>;
  if (pathname === '/evidence') return <Suspense fallback={<div className="mode-loading">加载中…</div>}><Evidence/></Suspense>;
  if (pathname === '/demo') return <AuthProvider><Suspense fallback={<div className="auth-loading">加载中...</div>}><Login demoMode /></Suspense></AuthProvider>;
  return <AuthProvider><AuthGate><Workspace themeMode={mode} onToggleTheme={toggleTheme}/></AuthGate></AuthProvider>;
}

type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'vantage-theme';

// 闸门：hydrate 完后看是否登录
function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  if (loading) {
    return (
      <div className="auth-loading">
        <div>加载中...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Suspense fallback={<div className="auth-loading">加载中...</div>}><Login /></Suspense>;
  return <>{children}</>;
}

function Workspace({
  themeMode,
  onToggleTheme,
}: {
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}) {
  return (
    <Suspense fallback={<div className="mode-loading">正在打开工作台…</div>}>
      <UnifiedApp themeMode={themeMode} onToggleTheme={onToggleTheme} />
    </Suspense>
  );
}

function Root() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem(THEME_KEY, mode);
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const toggleTheme = () => setMode(m => m === 'light' ? 'dark' : 'light');

  const Router = BrowserRouter;

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3370ff',
          colorInfo: '#3370ff',
          colorSuccess: mode === 'dark' ? '#56c339' : '#34c724',
          colorWarning: mode === 'dark' ? '#ff9a2e' : '#ff8800',
          colorError: mode === 'dark' ? '#ff6b66' : '#f54a45',
          colorLink: '#3370ff',
          colorTextLightSolid: '#ffffff',
          borderRadius: 6,
          fontSize: 14,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          colorBgLayout: mode === 'dark' ? '#1f2126' : '#f2f3f5',
          colorBgContainer: mode === 'dark' ? '#26282d' : '#ffffff',
          colorBgElevated: mode === 'dark' ? '#2e3138' : '#ffffff',
          colorBorder: mode === 'dark' ? '#3a3d44' : '#dee0e3',
          colorBorderSecondary: mode === 'dark' ? '#2e3138' : '#e9ebed',
          boxShadow: mode === 'dark'
            ? '0 2px 8px 0 rgba(0, 0, 0, 0.4)'
            : '0 2px 8px 0 rgba(31, 35, 41, 0.06)',
          boxShadowSecondary: mode === 'dark'
            ? '0 4px 16px 0 rgba(0, 0, 0, 0.5)'
            : '0 4px 16px 0 rgba(31, 35, 41, 0.08)'
        },
        components: {
          Layout: {
            headerBg: mode === 'dark' ? '#262a31' : '#ffffff',
            siderBg: mode === 'dark' ? '#262a31' : '#ffffff',
            bodyBg: mode === 'dark' ? '#1f2126' : '#f2f3f5'
          },
          Card: {
            borderRadiusLG: 8
          },
          Menu: {
            itemBg: 'transparent',
            itemSelectedBg: mode === 'dark' ? 'rgba(51, 112, 255, 0.18)' : '#e1eaff',
            itemHoverBg: mode === 'dark' ? '#2e3138' : '#f2f3f5',
            itemSelectedColor: '#3370ff',
            itemColor: mode === 'dark' ? '#a0a6ad' : '#646a73'
          },
          Table: {
            headerBg: mode === 'dark' ? '#212327' : '#f2f3f5',
            rowHoverBg: mode === 'dark' ? '#2e3138' : '#f2f3f5'
          },
          Tag: {
            defaultBg: mode === 'dark' ? '#2e3138' : '#f2f3f5'
          },
          Progress: {
            remainingColor: mode === 'dark' ? '#2e3138' : '#e9ebed'
          }
        }
      }}
    >
      <AntdApp>
        <Router>
          <Entry mode={mode} toggleTheme={toggleTheme} />
        </Router>
      </AntdApp>
    </ConfigProvider>
  );
}

if (typeof window !== 'undefined' && /Electron/i.test(navigator.userAgent)) {
  document.documentElement.classList.add('is-electron');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
