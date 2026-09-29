import { lazy, Suspense, useState } from "react";
import { Avatar, Button, Dropdown, Select, Tag, Tooltip } from "antd";
import {
  LogoutOutlined,
  AppstoreOutlined,
  MessageOutlined,
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
      {/* 飞书式左侧图标栏 */}
      <nav className="lark-rail" aria-label="主导航">
        <div className="lark-rail-logo" aria-hidden>
          <span className="brand-symbol">V</span>
        </div>
        <Tooltip title="Agent 对话" placement="right">
          <button className="lark-rail-item active" type="button">
            <MessageOutlined />
            <span>对话</span>
          </button>
        </Tooltip>
        <Tooltip title="切换到经典版" placement="right">
          <button className="lark-rail-item" type="button" onClick={onSwitchMode}>
            <AppstoreOutlined />
            <span>工作台</span>
          </button>
        </Tooltip>
        <div className="lark-rail-spacer" />
        <Tooltip title={themeMode === "dark" ? "切换浅色" : "切换深色"} placement="right">
          <button className="lark-rail-item" type="button" onClick={onToggleTheme}>
            {themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
            <span>外观</span>
          </button>
        </Tooltip>
        <Tooltip title="连接配置" placement="right">
          <button
            className="lark-rail-item"
            type="button"
            disabled={user?.is_demo || user?.is_trial}
            onClick={() => setSetup(true)}
          >
            <SettingOutlined />
            <span>配置</span>
          </button>
        </Tooltip>
        <Dropdown menu={accountMenu} trigger={["click"]} placement="topRight">
          <button className="lark-rail-item lark-rail-avatar" type="button" aria-label="账户菜单">
            <Avatar size={30} icon={<UserOutlined />} />
          </button>
        </Dropdown>
      </nav>

      <div className="lark-body">
        <header className="lark-topbar">
          <span className="lark-topbar-title">Vantage Agent</span>
          <Select
            aria-label="当前组织"
            value={currentOrgId}
            onChange={switchOrg}
            options={orgs.map((o) => ({ value: o.id, label: o.name }))}
            popupMatchSelectWidth={false}
            className="topbar-org-select"
          />
          <div className="lark-topbar-right">
            {user?.is_demo && (
              <Tooltip title="示例数据，只读浏览，不调用 API">
                <Tag className="topbar-demo-tag">Demo · 只读</Tag>
              </Tooltip>
            )}
            {user?.is_trial && user.trial && (
              <Tooltip title={user.trial.unlimited_usage ? `Agent 与搜索不限调用次数；到期：${user.trial.expires_at}` : `今日剩余 Agent ${user.trial.remaining.agent_runs} 次、搜索 ${user.trial.remaining.searches} 次；到期：${user.trial.expires_at}`}>
                <Tag className="topbar-demo-tag">测试账号{user.trial.unlimited_usage ? " · 开放额度" : " · 有限额"}</Tag>
              </Tooltip>
            )}
          </div>
        </header>
        <ErrorBoundary key={currentOrgId || "boundary"}>
          <Agent
            key={currentOrgId || "no-org"}
            onConfigure={() => setSetup(true)}
          />
        </ErrorBoundary>
      </div>
      {setup && (
        <Suspense fallback={null}>
          <SecureSetup key={currentOrgId} onClose={() => setSetup(false)} />
        </Suspense>
      )}
    </div>
  );
}