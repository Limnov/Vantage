import { lazy, Suspense } from "react";
import { Spin } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import AgentFirstApp from "./AgentFirstApp";

const ClassicApp = lazy(() => import("./ClassicApp"));

type AppMode = "agent" | "classic";

export default function App({
  themeMode,
  onToggleTheme,
}: {
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mode: AppMode =
    pathname === "/app" || pathname === "/login" ? "agent" : "classic";

  const switchMode = (next: AppMode) => {
    navigate(next === "classic" ? "/dashboard" : "/app", { replace: true });
  };

  if (mode === "classic") {
    return (
      <Suspense
        fallback={
          <div className="mode-loading">
            <Spin />
            <span>正在打开经典版…</span>
          </div>
        }
      >
        <ClassicApp
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
          onSwitchMode={() => switchMode("agent")}
        />
      </Suspense>
    );
  }

  return (
    <AgentFirstApp
      themeMode={themeMode}
      onToggleTheme={onToggleTheme}
      onSwitchMode={() => switchMode("classic")}
    />
  );
}
