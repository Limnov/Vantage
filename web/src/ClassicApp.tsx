import { Layout, Menu, theme, Tooltip, Space, Button, Input, Dropdown, Tag, Empty, Typography, Avatar, Popconfirm, Modal, Badge, message } from 'antd';
const { Text } = Typography;
import {
  DashboardOutlined, EyeOutlined, FileTextOutlined, WarningOutlined, SettingOutlined,
  MoonOutlined, SunOutlined, ReloadOutlined, SearchOutlined,
  RiseOutlined, FallOutlined, ArrowRightOutlined, TeamOutlined, RobotOutlined, AimOutlined,
  LogoutOutlined, UserOutlined, SwapOutlined, CrownOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  QuestionCircleOutlined, InfoCircleOutlined, BellOutlined, CheckOutlined, ApiOutlined,
  AppstoreOutlined, ControlOutlined, FileSearchOutlined
} from '@ant-design/icons';
import { Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import { searchApi, alertsApi } from './api';
import { useAuth } from './lib/auth';
import { Breadcrumb } from './components/Breadcrumb';
import { HelpModal } from './components/HelpModal';
import { APP_VERSION } from './version';
import './classic.css';

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
const Agent = lazy(() => import('./pages/ClassicAgent'));

const { Header, Sider, Content } = Layout;

interface Props {
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onSwitchMode: () => void;
}

// 当 Alerts 页面卸载时刷新待处理数量
function AlertsPendingRefresher({ onRefresh }: { onRefresh: () => void }) {
  useEffect(() => {
    return () => { onRefresh(); };
  }, [onRefresh]);
  return null;
}

export default function App({ themeMode, onToggleTheme, onSwitchMode }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, orgs, currentOrg, currentOrgId, switchOrg, logout } = useAuth();
  const { token } = theme.useToken();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  const [pendingAlertItems, setPendingAlertItems] = useState<any[]>([]);
  const [orgSwitching, setOrgSwitching] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);

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
    loadPendingAlerts();
    const t = setInterval(loadPendingAlerts, 60000);
    return () => clearInterval(t);
  }, [loadPendingAlerts]);

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
        const navMap: Record<string, string> = { '1': '/dashboard', '2': '/watchlist', '3': '/reports', '4': '/alerts', '5': '/agent', '6': '/settings' };
        if (navMap[e.key]) {
          e.preventDefault();
          navigate(navMap[e.key]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  // 切换组织：带视觉反馈
  const handleSwitchOrg = useCallback((orgId: number) => {
    if (orgId === currentOrgId) return;
    setOrgSwitching(true);
    switchOrg(orgId);
    // 模拟加载延迟，让用户看到反馈
    setTimeout(() => {
      setOrgSwitching(false);
      message.success(`已切换到「${orgs.find(o => o.id === orgId)?.name}」`);
    }, 400);
  }, [currentOrgId, switchOrg, orgs]);

  const orgMenuItems = orgs.map(o => ({
    key: String(o.id),
    label: (
      <Space>
        {o.id === currentOrgId && <CheckOutlined />}
        {o.name}
        <Tag style={{ marginLeft: 4 }}>{o.my_role}</Tag>
      </Space>
    ),
    onClick: () => handleSwitchOrg(o.id)
  }));

  const userMenuItems = [
    { key: 'info', label: (
      <div style={{ padding: '4px 0' }}>
        <div><Text strong>{user?.display_name || user?.username}</Text></div>
        <Text type="secondary" style={{ fontSize: 11 }}>@{user?.username} · {user?.email}</Text>
        {user?.is_system_admin && <div><Tag style={{ marginTop: 4 }}>系统超管</Tag></div>}
      </div>
    ), disabled: true },
    { type: 'divider' as const },
    { key: 'about', icon: <InfoCircleOutlined />, label: '关于', onClick: () => navigate('/about') },
    { key: 'help', icon: <QuestionCircleOutlined />, label: '帮助 & 快捷键 (?)', onClick: () => setHelpOpen(true) },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: () => { logout(); navigate('/dashboard'); } }
  ];

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
    <div style={{ width: 480, background: token.colorBgElevated, borderRadius: 8, boxShadow: token.boxShadowSecondary, overflow: 'hidden' }}>
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
      key: 'workspace',
      label: <span style={{ fontSize: 11, color: token.colorTextTertiary, letterSpacing: 1 }}>工作台</span>,
      type: 'group' as const,
      children: [
        { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">仪表盘</Link> },
        { key: '/watchlist', icon: <EyeOutlined />, label: <Link to="/watchlist">监控目标</Link> },
        { key: '/reports', icon: <FileTextOutlined />, label: <Link to="/reports">情报报告</Link> },
        { key: '/agent', icon: <ApiOutlined />, label: <Link to="/agent">Agent 工作台</Link> },
        { key: '/alerts', icon: <WarningOutlined />, label: (
          <Link to="/alerts">
            告警中心 {pendingAlerts > 0 && <Badge count={pendingAlerts} size="small" />}
          </Link>
        ) }
      ]
    },
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

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider
        className="classic-sider"
        width={220}
        collapsedWidth={isMobile ? 0 : 64}
        collapsed={siderCollapsed}
        trigger={null}
        collapsible
        style={{ borderRight: `1px solid ${token.colorBorder}` }}
      >
        <div className="app-brand" style={{ justifyContent: siderCollapsed ? 'center' : 'flex-start', padding: siderCollapsed ? '0' : '0 20px' }}>
          <div className="brand-icon">
            <img src="/vantage-logo.png" alt="" className="brand-logo brand-logo-light" />
            <img src="/vantage-logo-white.png" alt="" className="brand-logo brand-logo-dark" />
          </div>
          {!siderCollapsed && (
            <div className="brand-text">
              <span className="brand-name">Vantage</span>
              <span className="brand-tag">v{APP_VERSION} · Agent-first</span>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          style={{ borderRight: 0, paddingTop: 8 }}
          items={user?.is_demo ? menuGroups.filter(group => group.key === 'workspace') : menuGroups}
          inlineCollapsed={siderCollapsed}
        />
        {!siderCollapsed && (
          <div style={{ position: 'absolute', bottom: 12, left: 16, right: 16 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              <Space size={4}>
                <ApiOutlined />
                <span>v{APP_VERSION}</span>
              </Space>
            </Text>
          </div>
        )}
      </Sider>
      <Layout>
        <Header className="classic-header" style={{
          padding: '0 16px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorder}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <Tooltip title={siderCollapsed ? '展开侧边栏' : '折叠侧边栏'}>
            <Button
              type="text"
              className="classic-toolbar-button"
              aria-label={siderCollapsed ? '展开侧边栏' : '折叠侧边栏'}
              icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSiderCollapsed(!siderCollapsed)}
            />
          </Tooltip>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <Space size="middle" className="app-header-meta" style={{ flexShrink: 0 }}>
              <Dropdown
                menu={{ items: orgMenuItems }}
                trigger={['click']}
                disabled={orgSwitching}
              >
                <Button className="classic-org-switch" type="text" loading={orgSwitching} icon={<SwapOutlined spin={orgSwitching} />}>
                  <Space>
                    <Text strong>{currentOrg?.name || '选择组织'}</Text>
                    <Tag>{user?.is_demo ? '只读 Demo' : (currentOrg?.my_role || currentOrg?.role || '-')}</Tag>
                  </Space>
                </Button>
              </Dropdown>
            </Space>
          </div>
          <Space size={4} className="classic-header-actions" style={{ flexShrink: 0 }}>
            <Tooltip title="切换到 Agent-first">
              <Button
                className="classic-mode-switch"
                type="primary"
                aria-label="切换到 Agent-first"
                icon={<RobotOutlined />}
                onClick={onSwitchMode}
              >
                Agent-first
              </Button>
            </Tooltip>
            <Tooltip title="全局搜索 (⌘K)">
              <Dropdown
                open={searchOpen}
                onOpenChange={setSearchOpen}
                trigger={['click']}
                popupRender={() => searchPanel}
                placement="bottomRight"
              >
                <Button
                  type="text"
                  className="classic-toolbar-button classic-secondary-action"
                  aria-label="全局搜索"
                  disabled={user?.is_demo}
                  icon={<SearchOutlined />}
                />
              </Dropdown>
            </Tooltip>
            <Tooltip title="刷新">
              <Button
                type="text"
                className="classic-toolbar-button classic-secondary-action"
                aria-label="刷新页面"
                icon={<ReloadOutlined />}
                onClick={() => window.location.reload()}
              />
            </Tooltip>
            <Tooltip title={themeMode === 'dark' ? '切换浅色' : '切换深色'}>
              <Button
                type="text"
                className="classic-toolbar-button"
                aria-label={themeMode === 'dark' ? '切换浅色' : '切换深色'}
                icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                onClick={onToggleTheme}
              />
            </Tooltip>
            <Tooltip title="帮助 (?)">
              <Button
                type="text"
                className="classic-toolbar-button classic-secondary-action"
                aria-label="打开帮助"
                icon={<QuestionCircleOutlined />}
                onClick={() => setHelpOpen(true)}
              />
            </Tooltip>
            <Tooltip title="通知">
              <Dropdown menu={{ items: notificationItems }} trigger={['click']} placement="bottomRight">
                <Button type="text" className="classic-toolbar-button" aria-label="查看通知" icon={
                  <Badge count={pendingAlerts} size="small" offset={[-2, 2]}>
                    <BellOutlined />
                  </Badge>
                } />
              </Dropdown>
            </Tooltip>
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
              <Button
                type="text"
                className="classic-user-button"
                aria-label="打开用户菜单"
                icon={<Avatar size="small" icon={<UserOutlined />} />}
              >
                <span className="classic-user-name">{user?.display_name || user?.username}</span>
                {user?.is_system_admin && <Tag className="classic-user-role">超管</Tag>}
              </Button>
            </Dropdown>
          </Space>
        </Header>
        {user?.is_demo && <div className="demo-workspace-note" role="status">Demo · 真实工作台 / 示例数据 · 只读浏览，不提供 API Key，不执行真实调用。</div>}
        <Content className="classic-content" style={{
          margin: 16,
          padding: 24,
          overflow: 'auto',
          height: 'calc(100vh - 96px)'
        }}>
          <Breadcrumb />
          <div className="fade-in-up">
            <Suspense fallback={<div className="classic-page-loading">正在加载页面…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/agent" element={<Agent />} />
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
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {/* 暴露刷新函数给子路由 */}
      {location.pathname === '/alerts' && <AlertsPendingRefresher onRefresh={loadPendingAlerts} />}
    </Layout>
  );
}
