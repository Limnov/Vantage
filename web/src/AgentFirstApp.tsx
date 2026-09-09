import { lazy, Suspense, useState } from "react";
import { Avatar, Button, Dropdown, Select, Tag, Tooltip } from "antd";
import {
  LogoutOutlined,
  AppstoreOutlined,
  MoonOutlined,
  SunOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useAuth } from "./lib/auth";
import Agent from "./pages/Agent";
import { ErrorBoundary } from "./components/ErrorBoundary";
const SecureSetup = lazy(() => import("./components/SecureSetup"));
import "./agent.css";

export default function App({
  themeMode,
  onToggleTheme,
  onSwitchMode,
}: {
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
  onSwitchMode: () => void;
}) {
  const { user, orgs, currentOrgId, switchOrg, logout } = useAuth();
  const [setup, setSetup] = useState(false);
  const accountMenu = {
    items: [
      {
        key: "account",
        label: (
          <div className="topbar-account-summary">
            <strong>{user?.display_name || user?.username}</strong>
            <span>@{user?.username}</span>
          </div>
        ),
        disabled: true,
      },
      { type: "divider" as const },
      {
        key: "setup",
        icon: <SettingOutlined />,
        label: "连接配置",
        disabled: user?.is_demo || user?.is_trial,
        onClick: () => setSetup(true),
      },
      {
        key: "theme",
        icon: themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />,
        label: themeMode === "dark" ? "切换浅色" : "切换深色",
        onClick: onToggleTheme,
      },
      { type: "divider" as const },
      {
        key: "logout",
        icon: <LogoutOutlined />,
        label: "退出登录",
        danger: true,
        onClick: logout,
      },
    ],
  };
  return (
    <div className="agent-app">
      <header className="workspace-header">
        <a className="wordmark" href="/" aria-label="Vantage 首页">
          <span className="brand-symbol">V</span>Vantage
        </a>
        <div className="workspace-controls">
          <Select
            aria-label="当前组织"
            value={currentOrgId}
            onChange={switchOrg}
            options={orgs.map((o) => ({ value: o.id, label: o.name }))}
            popupMatchSelectWidth={false}
            className="topbar-org-select"
          />
          {user?.is_demo && (
            <Tooltip title="示例数据，只读浏览，不调用 API">
              <Tag className="topbar-demo-tag">Demo · 只读</Tag>
            </Tooltip>
          )}
          {user?.is_trial && user.trial && (
            <Tooltip title={`今日剩余 Agent ${user.trial.remaining.agent_runs} 次、搜索 ${user.trial.remaining.searches} 次；到期：${user.trial.expires_at}`}>
              <Tag className="topbar-demo-tag">测试账号 · 有限额</Tag>
            </Tooltip>
          )}
          <Tooltip title="切换到经典版">
            <Button
              type="primary"
              aria-label="切换到经典版"
              icon={<AppstoreOutlined />}
              onClick={onSwitchMode}
            >
              经典版
            </Button>
          </Tooltip>
          <Dropdown menu={accountMenu} trigger={["click"]} placement="bottomRight">
            <Button
              type="text"
              className="topbar-account-button"
              aria-label="打开账户菜单"
              icon={<Avatar size={28} icon={<UserOutlined />} />}
            />
          </Dropdown>
        </div>
      </header>
      <ErrorBoundary key={currentOrgId || "boundary"}>
        <Agent
          key={currentOrgId || "no-org"}
          onConfigure={() => setSetup(true)}
        />
      </ErrorBoundary>
      {setup && (
        <Suspense fallback={null}>
          <SecureSetup key={currentOrgId} onClose={() => setSetup(false)} />
        </Suspense>
      )}
    </div>
  );
}
