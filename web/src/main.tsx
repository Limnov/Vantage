import React, { useState, useEffect, lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { ConfigProvider, theme, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { AuthProvider, useAuth } from './lib/auth';
import Login from './pages/Login';
import 'antd/dist/reset.css';
import './index.css';

const Landing = lazy(() => import('./pages/Landing'));
const Demo = lazy(() => import('./pages/Demo'));

function Entry({mode,toggleTheme}: {mode: ThemeMode; toggleTheme: () => void}) {
  const {pathname} = useLocation();
  useEffect(() => {
    document.title = pathname === '/' ? 'Vantage — Agent 驱动的市场情报工作台' : pathname === '/demo' ? 'Vantage Demo · 独立场景演示' : 'Vantage · 工作台';
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://vantage.limnov.com${pathname}`);
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.setAttribute('name','robots'); document.head.appendChild(robots); }
    robots.setAttribute('content', pathname === '/' || pathname === '/demo' ? 'index,follow' : 'noindex,nofollow');
  }, [pathname]);
  if (pathname === '/' || pathname === '/demo') return <Suspense fallback={<div className="mode-loading">加载中…</div>}>{pathname === '/' ? <Landing/> : <Demo/>}</Suspense>;
  return <AuthProvider><AuthGate><App themeMode={mode} onToggleTheme={toggleTheme}/></AuthGate></AuthProvider>;
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
  if (!isAuthenticated) return <Login />;
  return <>{children}</>;
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
          colorPrimary: mode === 'dark' ? '#f2f0ec' : '#141414',
          colorInfo: mode === 'dark' ? '#f2f0ec' : '#141414',
          colorSuccess: mode === 'dark' ? '#ddd5c8' : '#403d36',
          colorWarning: mode === 'dark' ? '#c8bba5' : '#756a59',
          colorError: mode === 'dark' ? '#fff8ed' : '#191815',
          colorLink: mode === 'dark' ? '#f2f0ec' : '#141414',
          colorTextLightSolid: mode === 'dark' ? '#141414' : '#ffffff',
          borderRadius: 6,
          fontSize: 14,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          colorBgLayout: mode === 'dark' ? '#11100e' : '#eee9df',
          colorBgContainer: mode === 'dark' ? '#191815' : '#fffdf8',
          colorBgElevated: mode === 'dark' ? '#23211d' : '#fffdf8',
          colorBorder: mode === 'dark' ? '#3a362f' : '#d4cdbf',
          colorBorderSecondary: mode === 'dark' ? '#2a2823' : '#e6e0d6',
          boxShadow: mode === 'dark'
            ? '0 2px 8px 0 rgba(0, 0, 0, 0.5)'
            : '0 2px 8px 0 rgba(20, 20, 20, 0.05)',
          boxShadowSecondary: mode === 'dark'
            ? '0 4px 16px 0 rgba(0, 0, 0, 0.6)'
            : '0 4px 16px 0 rgba(20, 20, 20, 0.07)'
        },
        components: {
          Layout: {
            headerBg: mode === 'dark' ? '#191815' : '#fffdf8',
            siderBg: mode === 'dark' ? '#191815' : '#fffdf8',
            bodyBg: mode === 'dark' ? '#11100e' : '#eee9df'
          },
          Card: {
            borderRadiusLG: 8
          },
          Menu: {
            itemBg: 'transparent',
            itemSelectedBg: mode === 'dark' ? '#f5efe4' : '#191815',
            itemHoverBg: mode === 'dark' ? '#23211d' : '#f6f2e9',
            itemSelectedColor: mode === 'dark' ? '#191815' : '#fffdf8',
            itemColor: mode === 'dark' ? 'rgba(242, 240, 236, 0.65)' : 'rgba(20, 20, 20, 0.72)'
          },
          Table: {
            headerBg: mode === 'dark' ? '#23211d' : '#f6f2e9',
            rowHoverBg: mode === 'dark' ? '#23211d' : '#f6f2e9'
          },
          Tag: {
            defaultBg: mode === 'dark' ? '#23211d' : '#f6f2e9'
          },
          Progress: {
            remainingColor: mode === 'dark' ? '#2a2823' : '#e6e0d6'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
