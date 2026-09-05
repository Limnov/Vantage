import { lazy, Suspense, useEffect, useState } from "react";
import { Spin } from "antd";
import { useNavigate } from "react-router-dom";
import AgentFirstApp from "./AgentFirstApp";

const ClassicApp = lazy(() => import("./ClassicApp"));

type AppMode = "agent" | "classic";

const MODE_KEY = "vantage.ui-mode";

export default function App({
  themeMode,
  onToggleTheme,
}: {
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AppMode>(() =>
    localStorage.getItem(MODE_KEY) === "classic" ? "classic" : "agent",
  );

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  const switchMode = (next: AppMode) => {
    setMode(next);
    navigate(next === "classic" ? "/dashboard" : "/", { replace: true });
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
