import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CloseOutlined, MenuOutlined } from "@ant-design/icons";
import { productEnabled } from "../lib/deployment";

export const sourceUrl = "https://github.com/Limnov/Vantage";

const navItems = [
  { to: "/research", label: "研究" },
  { to: "/act", label: "行动" },
  { to: "/safety", label: "安全" },
  { to: "/evidence", label: "案例" }
];

/** 站点顶栏：品牌 + 独立页面导航 + 主 CTA */
export function SiteNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header className={"m-nav" + (scrolled ? " is-scrolled" : "")}>
      <div className="m-nav-inner">
        <Link className="m-brand" to="/" aria-label="Vantage 首页">
          <span className="m-brand-mark">V</span>
          <span>Vantage</span>
        </Link>
        <nav id="vantage-site-nav" className={"m-nav-links" + (menuOpen ? " is-open" : "")} aria-label="产品导航">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={pathname === item.to ? "is-current" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <a href={sourceUrl} target="_blank" rel="noreferrer">源码</a>
        </nav>
        <div className="m-nav-actions">
          <Link className="m-cta" to={productEnabled ? "/app" : "/demo"}>
            {productEnabled ? "进入产品" : "体验 Demo"}
          </Link>
          <button
            className="m-menu-toggle"
            type="button"
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
            aria-controls="vantage-site-nav"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <CloseOutlined /> : <MenuOutlined />}
          </button>
        </div>
      </div>
    </header>
  );
}

/** 站点页脚：三组链接 */
export function SiteFooter() {
  return (
    <footer className="m-footer">
      <div className="m-container m-footer-grid">
        <div>
          <span className="m-footer-head">产品</span>
          <Link to="/research">研究与核验</Link>
          <Link to="/act">监控与通知</Link>
          <Link to="/safety">安全边界</Link>
        </div>
        <div>
          <span className="m-footer-head">开发者</span>
          <a href={sourceUrl} target="_blank" rel="noreferrer">源代码</a>
          <a href={`${sourceUrl}/blob/main/README.md`} target="_blank" rel="noreferrer">部署文档</a>
          <a href={`${sourceUrl}/issues`} target="_blank" rel="noreferrer">问题反馈</a>
        </div>
        <div>
          <span className="m-footer-head">关于</span>
          <Link to="/evidence">案例</Link>
          <Link to="/demo">体验 Demo</Link>
          <span>2026 Freakz2z · MIT</span>
        </div>
      </div>
    </footer>
  );
}

export { useReveal } from "../lib/siteMotion";
