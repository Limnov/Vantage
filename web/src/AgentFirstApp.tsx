import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Select, Tooltip } from "antd";
import {
  LogoutOutlined,
  AppstoreOutlined,
  MoonOutlined,
  SunOutlined,
  SettingOutlined,
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
  return (
    <div className="agent-app">
      <header className="workspace-header">
        <a className="wordmark" href="/" aria-label="Vantage 首页">
          <span className="brand-symbol">V</span>Vantage
          <span className="wordmark-caption">情报与行动</span>
        </a>
        <div className="workspace-controls">
          <Select
            aria-label="当前组织"
            value={currentOrgId}
            onChange={switchOrg}
            options={orgs.map((o) => ({ value: o.id, label: o.name }))}
            style={{ minWidth: 130 }}
          />
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
          <Tooltip title="连接配置">
            <Button
              aria-label="连接配置"
              disabled={user?.is_demo}
              icon={<SettingOutlined />}
              onClick={() => setSetup(true)}
            />
          </Tooltip>
          <Tooltip title="切换主题">
            <Button
              aria-label="切换主题"
              icon={themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
              onClick={onToggleTheme}
            />
          </Tooltip>
          <Tooltip title={`${user?.display_name || user?.username} · 退出登录`}>
            <Button
              aria-label="退出登录"
              icon={<LogoutOutlined />}
              onClick={logout}
            />
          </Tooltip>
        </div>
      </header>
      {user?.is_demo && <div className="demo-workspace-note" role="status">Demo · 真实工作台 / 示例数据 · 可查看历史任务；不提供 API Key，不执行真实调用。</div>}
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
