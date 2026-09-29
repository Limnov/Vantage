import { Avatar, Button, Dropdown, Tooltip } from 'antd';
import {
  BellOutlined,
  DashboardOutlined,
  DownOutlined,
  EyeOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MoonOutlined,
  RobotOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

type Props = {
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onConfigure?: () => void;
};

const primary = [
  { path: '/app', label: 'Agent', icon: <RobotOutlined /> },
  { path: '/dashboard', label: '总览', icon: <DashboardOutlined /> },
  { path: '/watchlist', label: '监控', icon: <EyeOutlined /> },
  { path: '/reports', label: '报告', icon: <FileTextOutlined /> },
  { path: '/alerts', label: '告警', icon: <BellOutlined /> },
];

export default function WorkspaceRail({ themeMode, onToggleTheme, onConfigure }: Props) {
  const { user, orgs, currentOrg, currentOrgId, switchOrg, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => setMobile(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const orgItems = orgs.map((org) => ({
    key: String(org.id),
    label: <span className="rail-org-option"><span>{org.name}</span><small>{org.my_role}</small></span>,
    onClick: () => switchOrg(org.id),
  }));
  const accountItems = [
    { key: 'name', label: <span className="rail-account-name">{user?.display_name || user?.username}</span>, disabled: true },
    { type: 'divider' as const },
    { key: 'theme', icon: themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />, label: themeMode === 'dark' ? '浅色外观' : '深色外观', onClick: onToggleTheme },
    { key: 'settings', icon: <SettingOutlined />, label: '设置', onClick: () => location.pathname === '/app' && onConfigure ? onConfigure() : navigate('/settings'), disabled: location.pathname === '/app' && (user?.is_demo || user?.is_trial) },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: logout },
  ];

  return (
    <aside className="workspace-rail" aria-label="Vantage 主导航">
      <NavLink to="/app" className="rail-brand" aria-label="Vantage Agent 工作台">
        <span className="rail-brand-mark">V</span>
        <span className="rail-brand-name">Vantage</span>
      </NavLink>
      <Dropdown menu={{ items: orgItems, selectedKeys: currentOrgId ? [String(currentOrgId)] : [] }} trigger={['click']} placement="bottomLeft">
        <Button className="rail-org" aria-label={`当前组织 ${currentOrg?.name || '请选择组织'}`}>
          <span className="rail-org-mark">{(currentOrg?.name || '组').slice(0, 1)}</span>
          <span className="rail-org-name">{currentOrg?.name || '选择组织'}</span>
          <DownOutlined className="rail-org-chevron" />
        </Button>
      </Dropdown>
      <div className="rail-group-label">工作台</div>
      <nav className="rail-nav" aria-label="业务模块">
        {primary.map((item) => (
          <Tooltip key={item.path} title={item.label} placement="right" mouseEnterDelay={0.6} open={mobile ? false : undefined}>
            <NavLink
              to={item.path}
              className={({ isActive }) => `rail-nav-item ${isActive || (item.path === '/app' && location.pathname === '/agent') ? 'active' : ''}`}
              aria-label={item.label}
            >
              {item.icon}<span>{item.label}</span>
            </NavLink>
          </Tooltip>
        ))}
      </nav>
      <div className="rail-spacer" />
      {!user?.is_demo && (
        <Tooltip title="设置" placement="right" mouseEnterDelay={0.6} open={mobile ? false : undefined}>
          <NavLink to="/settings" className={({ isActive }) => `rail-nav-item rail-settings ${isActive ? 'active' : ''}`} aria-label="设置">
            <SettingOutlined /><span>设置</span>
          </NavLink>
        </Tooltip>
      )}
      <div className="rail-account-wrap">
        <Dropdown menu={{ items: accountItems }} trigger={['click']} placement="topLeft">
          <Button className="rail-account" aria-label="打开账户菜单">
            <Avatar size={30} icon={<UserOutlined />} />
            <span className="rail-account-text"><strong>{user?.display_name || user?.username}</strong><small>{user?.is_demo ? 'Demo · 只读' : user?.is_trial ? '测试账号' : '我的账户'}</small></span>
            <DownOutlined className="rail-account-chevron" />
          </Button>
        </Dropdown>
      </div>
    </aside>
  );
}
