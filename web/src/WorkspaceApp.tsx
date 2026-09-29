import { Layout, Menu, theme, Tooltip, Space, Button, Input, Dropdown, Tag, Empty, Typography, Badge } from 'antd';
const { Text } = Typography;
import {
  EyeOutlined, FileTextOutlined, WarningOutlined, SettingOutlined,
  SearchOutlined,
  RiseOutlined, FallOutlined, ArrowRightOutlined, TeamOutlined, RobotOutlined, AimOutlined,
  UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  InfoCircleOutlined, BellOutlined,
  FileSearchOutlined
} from '@ant-design/icons';
import { Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import { searchApi, alertsApi } from './api';
import { useAuth } from './lib/auth';
import { HelpModal } from './components/HelpModal';
import WorkspaceRail from './components/WorkspaceRail';
import AgentWorkspace from './pages/Agent';
import { ErrorBoundary } from './components/ErrorBoundary';
import './agent.css';
import './classic.css';
import './workspace.css';
const SecureSetup = lazy(() => import('./components/SecureSetup'));

const Logs = lazy(() => import('./pages/Logs'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Reports = lazy(() => import('./pages/Reports'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Settings = lazy(() => import('./pages/Settings'));
const Organization = lazy(() => import('./pages/Organization'));
const Bots = lazy(() => import('./pages/Bots'));
const AlertRoutes = lazy(() => import('./pages/AlertRoutes'));
const Members = lazy(() => import('./pages/Members'));
const About = lazy(() => import('./pages/About'));

const { Header, Sider, Content } = Layout;

interface Props {
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
}

// 当 Alerts 页面卸载时刷新待处理数量
function AlertsPendingRefresher({ onRefresh }: { onRefresh: () => void }) {
  useEffect(() => {
    return () => { onRefresh(); };
  }, [onRefresh]);
  return null;
}

export default function App({ themeMode, onToggleTheme }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, currentOrgId } = useAuth();
  const { token } = theme.useToken();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  const [pendingAlertItems, setPendingAlertItems] = useState<any[]>([]);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const [setup, setSetup] = useState(false);
  const isAgentView = location.pathname === '/app';
  const showManagementSider = ['/organization', '/members', '/bots', '/routes', '/logs', '/settings', '/about'].includes(location.pathname);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => { setIsMobile(media.matches); if (media.matches) setSiderCollapsed(true); };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // 待处理告警数量（顶栏铃铛）
  const loadPendingAlerts = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const r = await alertsApi.list({ status: 'pending', pageSize: 5 });
      setPendingAlerts(r.total || 0);
      setPendingAlertItems(r.items || []);
    } catch {}
  }, [currentOrgId]);

  useEffect(() => {
    if (isAgentView) return;
    loadPendingAlerts();
    const t = setInterval(loadPendingAlerts, 60000);
    return () => clearInterval(t);
  }, [isAgentView, loadPendingAlerts]);

  useEffect(() => {
    if (!searchQ || searchQ.length < 2) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await searchApi.global(searchQ);
        setSearchResults(r);
      } catch {
        setSearchResults({ total: 0, results: {} });
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQ]);

  // 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === '?' && !inInput) {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setHelpOpen(false);
        return;
      }
      // 数字键导航（不在输入框时）
      if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const navMap: Record<string, string> = { '1': '/dashboard', '2': '/watchlist', '3': '/reports', '4': '/alerts', '5': '/app', '6': '/settings' };
        if (navMap[e.key]) {
          e.preventDefault();
          navigate(navMap[e.key]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  const notificationItems = [
    {
      key: 'header',
      label: (
        <div style={{ padding: '4px 12px', display: 'flex', justifyContent: 'space-between' }}>
          <Text strong>待处理告警</Text>
          <a onClick={() => navigate('/alerts')}>查看全部</a>
        </div>
      ),
      disabled: true
    },
    { type: 'divider' as const },
    ...(pendingAlertItems.length === 0
      ? [{ key: 'empty', label: <div style={{ padding: 24, textAlign: 'center', color: 'var(--v-text-3)' }}>暂无待处理告警</div>, disabled: true }]
      : pendingAlertItems.map((a: any) => ({
          key: `alert-${a.id}`,
          label: (
            <div style={{ padding: '4px 0', maxWidth: 280 }}>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>{a.title}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>{a.message?.substring(0, 50)}...</Text>
              <div style={{ fontSize: 11, color: 'var(--v-text-3)', marginTop: 2 }}>{dayjs(a.created_at).format('MM-DD HH:mm')}</div>
            </div>
          ),
          onClick: () => navigate('/alerts')
        })))
  ];

  const searchPanel = (
    <div style={{ width: 'min(480px, calc(100vw - 24px))', background: token.colorBgElevated, borderRadius: 8, boxShadow: token.boxShadowSecondary, overflow: 'hidden' }}>
      <Input
        size="large"
        prefix={<SearchOutlined />}
        placeholder="搜索监控、报告、告警..."
        value={searchQ}
        onChange={e => setSearchQ(e.target.value)}
        autoFocus
        suffix={<Text type="secondary" style={{ fontSize: 11 }}>ESC</Text>}
        style={{ borderRadius: 0, border: 0, borderBottom: `1px solid ${token.colorBorder}` }}
      />
      <div style={{ maxHeight: 400, overflow: 'auto', padding: 8 }}>
        {searchLoading && <div style={{ padding: 20, textAlign: 'center' }}>搜索中...</div>}
        {!searchLoading && searchResults && searchResults.total === 0 && (
          <Empty description="无匹配结果" style={{ padding: 24 }} />
        )}
        {!searchLoading && searchResults && (
          <>
            {searchResults.results?.watchlist?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ padding: '6px 8px', fontSize: 11, color: token.colorTextTertiary, fontWeight: 600, letterSpacing: 0.5 }}>监控目标</div>
                {searchResults.results.watchlist?.map((w: any) => (
                  <div key={`w-${w.id}`} onClick={() => { navigate('/watchlist'); setSearchOpen(false); setSearchQ(''); }}
                    style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <EyeOutlined style={{ color: 'var(--v-text-2)' }} />
                      <span style={{ fontWeight: 500 }}>{w.name}</span>
                      <Tag style={{ marginLeft: 0 }}>P{w.priority}</Tag>
                    </Space>
                    <ArrowRightOutlined style={{ color: token.colorTextTertiary, fontSize: 11 }} />
                  </div>
                ))}
              </div>
            )}
            {searchResults.results?.reports?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ padding: '6px 8px', fontSize: 11, color: token.colorTextTertiary, fontWeight: 600, letterSpacing: 0.5 }}>情报报告</div>
                {searchResults.results.reports?.map((r: any) => {
                  const sigIcon = r.signal_type === 'opportunity' ? <RiseOutlined /> :
                                  r.signal_type === 'risk' ? <FallOutlined /> : null;
                  return (
                    <div key={`r-${r.id}`} onClick={() => { navigate('/reports'); setSearchOpen(false); setSearchQ(''); }}
                      style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}>
                      <Space>
                        {sigIcon || <FileTextOutlined />}
                        <span style={{ fontWeight: 500 }}>{r.title}</span>
                      </Space>
                      <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2, paddingLeft: 22 }}>
                        {r.summary?.substring(0, 60)}...
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {searchResults.results?.alerts?.length > 0 && (
              <div>
                <div style={{ padding: '6px 8px', fontSize: 11, color: token.colorTextTertiary, fontWeight: 600, letterSpacing: 0.5 }}>告警</div>
                {searchResults.results.alerts?.map((a: any) => (
                  <div key={`a-${a.id}`} onClick={() => { navigate('/alerts'); setSearchOpen(false); setSearchQ(''); }}
                    style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}>
                    <Space>
                      <WarningOutlined style={{ color: a.level === 'critical' ? 'var(--v-risk)' : 'var(--v-warn)' }} />
                      <span style={{ fontWeight: 500 }}>{a.title}</span>
                      <Tag style={{ marginLeft: 0 }}>{a.status}</Tag>
                    </Space>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // 菜单分组
  const menuGroups = [
    {
      key: 'admin',
      label: <span style={{ fontSize: 11, color: token.colorTextTertiary, letterSpacing: 1 }}>管理</span>,
      type: 'group' as const,
      children: [
        { key: '/organization', icon: <TeamOutlined />, label: <Link to="/organization">组织管理</Link> },
        { key: '/members', icon: <UserOutlined />, label: <Link to="/members">成员</Link> },
        { key: '/bots', icon: <RobotOutlined />, label: <Link to="/bots">飞书 Bot</Link> },
        { key: '/routes', icon: <AimOutlined />, label: <Link to="/routes">告警路由</Link> }
      ]
    },
    {
      key: 'system',
      label: <span style={{ fontSize: 11, color: token.colorTextTertiary, letterSpacing: 1 }}>系统</span>,
      type: 'group' as const,
      children: [
        { key: '/logs', icon: <FileSearchOutlined />, label: <Link to="/logs">系统日志</Link> },
        { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">系统设置</Link> },
        { key: '/about', icon: <InfoCircleOutlined />, label: <Link to="/about">关于</Link> }
      ]
    }
  ];

  const selected = location.pathname;
  const pageTitle = ({
    '/dashboard': '总览', '/watchlist': '监控目标', '/reports': '情报报告',
    '/alerts': '告警中心', '/organization': '组织管理', '/members': '成员',
    '/bots': '飞书 Bot', '/routes': '告警路由', '/logs': '系统日志',
    '/settings': '系统设置', '/about': '关于 Vantage'
  } as Record<string, string>)[selected] || '工作台';

  if (user?.is_demo && showManagementSider && selected !== '/about') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="unified-workspace-shell">
    <WorkspaceRail
      themeMode={themeMode}
      onToggleTheme={onToggleTheme}
      onConfigure={() => setSetup(true)}
      searchPanel={searchPanel}
      searchOpen={searchOpen && !isMobile}
      onSearchOpenChange={setSearchOpen}
    />
    {isAgentView ? (
      <div className="agent-workspace-content">
        <ErrorBoundary key={currentOrgId || 'boundary'}>
          <AgentWorkspace key={currentOrgId || 'no-org'} onConfigure={() => setSetup(true)} />
        </ErrorBoundary>
      </div>
    ) : (
    <Layout className="classic-workspace-inner" style={{ height: '100vh', overflow: 'hidden' }}>
      {showManagementSider && <Sider
        className="classic-sider"
        width={256}
        collapsedWidth={isMobile ? 0 : 64}
        collapsed={siderCollapsed}
        trigger={null}
        collapsible
        style={{ borderRight: `1px solid ${token.colorBorder}` }}
      >
        <div className="classic-section-heading">
          {!siderCollapsed && <><strong>管理</strong><small>组织与系统</small></>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          style={{ borderRight: 0, paddingTop: 8 }}
          items={menuGroups}
          inlineCollapsed={siderCollapsed}
        />
      </Sider>}
      <Layout>
        <Header className="classic-header" style={{
          padding: '0 16px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorder}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          {showManagementSider && <Tooltip title={siderCollapsed ? '展开侧边栏' : '折叠侧边栏'}>
            <Button
              type="text"
              className="classic-toolbar-button"
              aria-label={siderCollapsed ? '展开侧边栏' : '折叠侧边栏'}
              icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSiderCollapsed(!siderCollapsed)}
            />
          </Tooltip>}
          <h1 className="classic-view-title">{pageTitle}</h1>
          <div style={{ flex: 1 }} />
          <Space size={4} className="classic-header-actions" style={{ flexShrink: 0 }}>
            {isMobile && <Dropdown open={searchOpen} onOpenChange={setSearchOpen} trigger={['click']} popupRender={() => searchPanel} placement="bottomRight">
              <Button type="text" className="classic-toolbar-button" aria-label="搜索工作台" icon={<SearchOutlined />} />
            </Dropdown>}
            <Tooltip title="通知">
              <Dropdown menu={{ items: notificationItems }} trigger={['click']} placement="bottomRight">
                <Button type="text" className="classic-toolbar-button" aria-label="查看通知" icon={
                  <Badge count={pendingAlerts} size="small" offset={[-2, 2]}>
                    <BellOutlined />
                  </Badge>
                } />
              </Dropdown>
            </Tooltip>
          </Space>
        </Header>
        <Content className="classic-content" style={{
          margin: 16,
          padding: 24,
          overflow: 'auto',
          height: 'calc(100vh - 96px)'
        }}>
          <div className="fade-in-up">
            <Suspense fallback={<div className="classic-page-loading">正在加载页面…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/agent" element={<Navigate to="/app" replace />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/organization" element={<Organization />} />
              <Route path="/members" element={<Members />} />
              <Route path="/bots" element={<Bots />} />
              <Route path="/routes" element={<AlertRoutes />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<About />} />
            </Routes>
            </Suspense>
          </div>
        </Content>
      </Layout>
      {/* 暴露刷新函数给子路由 */}
      {location.pathname === '/alerts' && <AlertsPendingRefresher onRefresh={loadPendingAlerts} />}
    </Layout>
    )}
    <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    {setup && <Suspense fallback={null}><SecureSetup key={currentOrgId} onClose={() => setSetup(false)} /></Suspense>}
    </div>
  );
}
