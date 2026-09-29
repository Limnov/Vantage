import { Layout, Menu, theme, Tooltip, Space, Button, Input, Dropdown, Tag, Empty, Typography, Avatar, Badge, Divider } from 'antd';
const { Text } = Typography;
import {
  DashboardOutlined, EyeOutlined, FileTextOutlined, WarningOutlined, SettingOutlined,
  MoonOutlined, SunOutlined, ReloadOutlined, SearchOutlined,
  RiseOutlined, FallOutlined, ArrowRightOutlined, TeamOutlined, RobotOutlined, AimOutlined,
  LogoutOutlined, UserOutlined,
  QuestionCircleOutlined, InfoCircleOutlined, BellOutlined, CheckOutlined, ApiOutlined,
  FileSearchOutlined, PlusOutlined, MessageOutlined
} from '@ant-design/icons';
import { Routes, Route, Link, useLocation, useNavigate, Navigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import { searchApi, alertsApi, agentApi } from './api';
import { useAuth } from './lib/auth';
import { Breadcrumb } from './components/Breadcrumb';
import { HelpModal } from './components/HelpModal';
import { APP_VERSION } from './version';
import Agent from './pages/Agent';
import './classic.css';
import './agent.css';

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

const { Content } = Layout;

interface Props {
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
}

type Run = {
  id: string;
  goal: string;
  status: string;
  metadata?: any;
  result?: any;
  created_at?: string;
};

const threadOf = (r: Run) => r.metadata?.conversation_id || r.id;

function dayGroupLabel(iso?: string): string {
  if (!iso) return '更早';
  const d = dayjs(iso);
  const today = dayjs();
  if (d.isSame(today, 'day')) return '今天';
  if (d.isSame(today.subtract(1, 'day'), 'day')) return '昨天';
  if (d.isSame(today, 'year')) return d.format('M 月 D 日');
  return d.format('YYYY 年 M 月 D 日');
}

// Agent 路由包装：从 URL 读取当前会话
function AgentRoute({ onConfigure }: { onConfigure: () => void }) {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  return (
    <Agent
      onConfigure={onConfigure}
      thread={threadId || null}
      onThreadChange={(id) => navigate(id ? `/app/t/${id}` : '/app', { replace: false })}
    />
  );
}

export default function UnifiedApp({ themeMode, onToggleTheme }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, orgs, currentOrg, currentOrgId, switchOrg, logout } = useAuth();
  const { token } = theme.useToken();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  const [pendingAlertItems, setPendingAlertItems] = useState<any[]>([]);
  const [orgSwitching, setOrgSwitching] = useState(false);

  // 会话历史（侧边栏）
  const [threads, setThreads] = useState<Run[]>([]);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);

  const inAgent = location.pathname === '/app' || location.pathname.startsWith('/app/');
  const activeThread = inAgent && location.pathname.startsWith('/app/t/')
    ? location.pathname.slice('/app/t/'.length)
    : null;

  const loadThreads = useCallback(async (append = false) => {
    setThreadsLoading(true);
    try {
      const r = await agentApi.list({ limit: 50, offset: append ? threads.length : 0 });
      setThreadsTotal(r.total || 0);
      setThreads(prev => {
        const items: Run[] = r.items || [];
        if (!append) return items;
        const seen = new Set(prev.map(threadOf));
        return [...prev, ...items.filter(i => !seen.has(threadOf(i)))];
      });
    } catch {
      // 侧边栏历史失败不打断主流程
    } finally {
      setThreadsLoading(false);
    }
  }, [threads.length]);

  useEffect(() => {
    void loadThreads();
  }, [historyRevision, currentOrgId, loadThreads]);

  // 待处理告警数量（侧边栏铃铛）
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
      }
      if (e.key === '?' && !inInput) {
        e.preventDefault();
        setHelpOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSwitchOrg = useCallback((orgId: number) => {
    if (orgId === currentOrgId) return;
    setOrgSwitching(true);
    switchOrg(orgId);
    setTimeout(() => setOrgSwitching(false), 400);
  }, [currentOrgId, switchOrg]);

  const orgMenuItems = orgs.map(o => ({
    key: String(o.id),
    label: (
      <Space>
        {o.id === currentOrgId && <CheckOutlined />}
        {o.name}
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
    { key: 'refresh', icon: <ReloadOutlined />, label: '刷新当前页面', onClick: () => window.location.reload() },
    { key: 'theme', icon: themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />, label: themeMode === 'dark' ? '切换浅色' : '切换深色', onClick: onToggleTheme },
    { key: 'about', icon: <InfoCircleOutlined />, label: '关于', onClick: () => navigate('/about') },
    { key: 'help', icon: <QuestionCircleOutlined />, label: '帮助 & 快捷键 (?)', onClick: () => setHelpOpen(true) },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: () => { logout(); navigate('/app'); } }
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
                      <EyeOutlined />
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

  // 业务导航（Agent 对话在上方列表，不占菜单项）
  const menuGroups = [
    {
      key: 'workspace',
      label: <span className="uni-group-title">工作台</span>,
      type: 'group' as const,
      children: [
        { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">仪表盘</Link> },
        { key: '/watchlist', icon: <EyeOutlined />, label: <Link to="/watchlist">监控目标</Link> },
        { key: '/reports', icon: <FileTextOutlined />, label: <Link to="/reports">情报报告</Link> },
        { key: '/alerts', icon: <WarningOutlined />, label: (
          <Link to="/alerts">
            告警中心 {pendingAlerts > 0 && <Badge count={pendingAlerts} size="small" />}
          </Link>
        ) }
      ]
    },
    ...(!user?.is_demo ? [
      {
        key: 'admin',
        label: <span className="uni-group-title">管理</span>,
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
        label: <span className="uni-group-title">系统</span>,
        type: 'group' as const,
        children: [
          { key: '/logs', icon: <FileSearchOutlined />, label: <Link to="/logs">系统日志</Link> },
          { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">系统设置</Link> },
          { key: '/about', icon: <InfoCircleOutlined />, label: <Link to="/about">关于</Link> }
        ]
      }
    ] : [])
  ];

  // 会话按天分组
  const threadGroups: { label: string; items: Run[] }[] = [];
  let lastLabel = '';
  for (const t of threads) {
    const label = dayGroupLabel(t.created_at);
    if (label !== lastLabel) {
      threadGroups.push({ label, items: [t] });
      lastLabel = label;
    } else {
      threadGroups[threadGroups.length - 1].items.push(t);
    }
  }

  const selected = inAgent ? [] : [location.pathname];

  return (
    <Layout className="uni-app">
      <Layout.Sider className="uni-sider" width={248} trigger={null}>
        {/* 品牌 + 组织 */}
        <div className="uni-sider-top">
          <div className="uni-brand">
            <span className="brand-symbol">V</span>
            <span className="uni-brand-name">Vantage</span>
          </div>
          <Dropdown menu={{ items: orgMenuItems }} trigger={['click']} disabled={orgSwitching}>
            <Button className="uni-org-switch" type="text" loading={orgSwitching} block>
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text strong ellipsis style={{ maxWidth: 150 }}>{currentOrg?.name || '选择组织'}</Text>
                {user?.is_demo ? <Tag className="topbar-demo-tag">Demo</Tag> : null}
              </Space>
            </Button>
          </Dropdown>
          <Dropdown
            open={searchOpen}
            onOpenChange={setSearchOpen}
            trigger={['click']}
            popupRender={() => searchPanel}
            placement="bottomLeft"
          >
            <button className="uni-search-trigger" type="button" disabled={user?.is_demo}>
              <SearchOutlined />
              <span>搜索监控、报告、告警</span>
              <Text type="secondary" style={{ fontSize: 10, marginLeft: 'auto' }}>⌘K</Text>
            </button>
          </Dropdown>
        </div>

        {/* 会话列表 */}
        <div className="uni-threads">
          <Button
            className="new-conversation"
            icon={<PlusOutlined />}
            onClick={() => navigate('/app')}
            disabled={user?.is_demo}
          >
            新建对话
          </Button>
          <div className="sidebar-label">
            最近对话
            <Button
              type="text"
              size="small"
              aria-label="刷新对话"
              icon={<ReloadOutlined />}
              onClick={() => setHistoryRevision(v => v + 1)}
            />
          </div>
          <nav className="uni-thread-list" aria-label="对话历史">
            {threadsLoading && !threads.length && <p className="history-empty">加载中…</p>}
            {!threadsLoading && !threads.length && (
              <p className="history-empty">
                你的目标、证据和行动
                <br />
                会保存在这里。
              </p>
            )}
            {threadGroups.map(g => (
              <div key={g.label}>
                <div className="uni-day-label">{g.label}</div>
                {g.items.map(r => (
                  <button
                    className={`history-item ${activeThread === threadOf(r) ? 'selected' : ''}`}
                    key={threadOf(r)}
                    onClick={() => navigate(`/app/t/${threadOf(r)}`)}
                  >
                    <MessageOutlined />
                    <span>{r.goal}</span>
                    <i className={`status-dot ${r.status}`} title={r.status} />
                  </button>
                ))}
              </div>
            ))}
            {threads.length < threadsTotal && (
              <Button type="text" size="small" onClick={() => loadThreads(true)}>
                加载更早对话
              </Button>
            )}
          </nav>
        </div>

        {/* 业务导航 */}
        <div className="uni-nav">
          <Menu
            mode="inline"
            selectedKeys={selected}
            style={{ borderRight: 0 }}
            items={menuGroups}
          />
        </div>

        {/* 底部工具 */}
        <div className="uni-sider-bottom">
          <Space size={2}>
            <Tooltip title="通知" placement="top">
              <Dropdown menu={{ items: notificationItems }} trigger={['click']} placement="topRight">
                <Button type="text" className="uni-tool-button" aria-label="查看通知" icon={
                  <Badge count={pendingAlerts} size="small" offset={[-2, 2]}>
                    <BellOutlined />
                  </Badge>
                } />
              </Dropdown>
            </Tooltip>
            <Tooltip title={themeMode === 'dark' ? '切换浅色' : '切换深色'} placement="top">
              <Button type="text" className="uni-tool-button" aria-label="切换主题" onClick={onToggleTheme}
                icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />} />
            </Tooltip>
            <Tooltip title="帮助 (?)" placement="top">
              <Button type="text" className="uni-tool-button" aria-label="帮助" onClick={() => setHelpOpen(true)}
                icon={<QuestionCircleOutlined />} />
            </Tooltip>
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="topRight">
              <Button type="text" className="uni-tool-button uni-avatar-button" aria-label="账户菜单"
                icon={<Avatar size={26} icon={<UserOutlined />} />} />
            </Dropdown>
          </Space>
          <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 6 }}>
            <ApiOutlined /> v{APP_VERSION}
          </Text>
        </div>
      </Layout.Sider>

      <Content className="uni-content">
        <div className="uni-content-inner">
          {!inAgent && <Breadcrumb />}
          <div className="fade-in-up">
            <Suspense fallback={<div className="classic-page-loading">正在加载页面…</div>}>
              <Routes>
                <Route path="/" element={<Navigate to="/app" replace />} />
                <Route path="/app" element={<AgentRoute onConfigure={() => navigate('/settings')} />} />
                <Route path="/app/t/:threadId" element={<AgentRoute onConfigure={() => navigate('/settings')} />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/watchlist" element={<Watchlist />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/organization" element={<Organization />} />
                <Route path="/members" element={<Members />} />
                <Route path="/bots" element={<Bots />} />
                <Route path="/routes" element={<AlertRoutes />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/about" element={<About />} />
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      </Content>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Layout>
  );
}