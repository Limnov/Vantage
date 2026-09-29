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
const WorkspaceApp = lazy(() => import('./WorkspaceApp'));


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
  const dark = themeMode === 'dark';
  return (
    <Suspense fallback={<div className="workspace-loading">正在打开工作台…</div>}>
      <ConfigProvider locale={zhCN} theme={{
        token: {
          colorPrimary: dark ? '#4f8cff' : '#3370ff',
          colorInfo: dark ? '#4f8cff' : '#3370ff',
          colorSuccess: dark ? '#57c89b' : '#199a69',
          colorWarning: dark ? '#efbb63' : '#b97216',
          colorError: dark ? '#f07878' : '#d84a4a',
          colorLink: dark ? '#78a5ff' : '#2865de',
          colorText: dark ? '#f3f4f6' : '#1f2329',
          colorTextSecondary: dark ? '#a9adb7' : '#646a75',
          colorBgLayout: dark ? '#17181b' : '#f5f6f8',
          colorBgContainer: dark ? '#202124' : '#ffffff',
          colorBgElevated: dark ? '#292b30' : '#ffffff',
          colorBorder: dark ? '#383b42' : '#dfe2e8',
          colorBorderSecondary: dark ? '#303239' : '#eef0f3',
          borderRadius: 8,
          boxShadow: 'none',
          boxShadowSecondary: dark ? '0 16px 48px rgba(0,0,0,.35)' : '0 16px 48px rgba(30,39,58,.12)',
        },
        components: {
          Layout: { headerBg: dark ? '#202124' : '#ffffff', siderBg: dark ? '#202124' : '#ffffff', bodyBg: dark ? '#17181b' : '#f5f6f8' },
          Menu: { itemSelectedBg: dark ? '#303f60' : '#e8f0ff', itemSelectedColor: dark ? '#78a5ff' : '#2865de', itemHoverBg: dark ? '#2b2d33' : '#f2f4f8' },
          Table: { headerBg: dark ? '#24262a' : '#f8f9fb', rowHoverBg: dark ? '#292c32' : '#f6f8fc' },
          Tag: { defaultBg: dark ? '#303239' : '#f3f5f8' },
        },
      }}>
        <WorkspaceApp themeMode={themeMode} onToggleTheme={onToggleTheme} />
      </ConfigProvider>
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
