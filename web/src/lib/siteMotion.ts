import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * 站点滚动动效（学 MetaMask 的 GSAP + ScrollTrigger 用法）：
 * - hero 入场时间线：逐行标题 → 说明 → 按钮 → 产品图
 * - 产品图随滚动轻微视差（scrub，不使用 pin，避免页面高度变化）
 * - 区块内元素进入视口时错位淡入（stagger）
 * - 数据条数字滚动到位
 *
 * 无 JS 与「减少动效」偏好下内容直接可见：隐藏初始态只在 JS 就绪时挂到 <html>。
 */
export function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    gsap.registerPlugin(ScrollTrigger);
    root.classList.add("m-motion");

    const ctx = gsap.context(() => {
      // 1) hero 入场
      const hero = document.querySelector(".m-hero, .m-page-hero");
      const nav = document.querySelector(".m-nav-inner");
      if (nav) {
        gsap.from(nav, { y: -14, opacity: 0, duration: 0.5, ease: "power3.out" });
      }
      if (hero) {
        const lines = hero.querySelectorAll("h1 span, h1");
        const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.75 } });
        tl.from(".m-promo", { y: 12, opacity: 0 })
          .from(lines.length > 1 ? lines : hero.querySelector("h1"), { y: 28, opacity: 0, stagger: 0.1 }, "-=0.35")
          .from(hero.querySelector(".m-lede, .m-hero-actions"), { y: 16, opacity: 0, stagger: 0.08 }, "-=0.45")
          .from(hero.querySelector(".m-hero-art") ?? hero.querySelector("h1"), { y: 40, opacity: 0, duration: 0.9 }, "-=0.4");
      }

      // 2) 产品图视差
      const art = document.querySelector(".m-hero-art");
      if (art && hero) {
        gsap.to(art, {
          yPercent: -7,
          ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 },
        });
      }

      // 3) 区块元素错位淡入
      const groups = new Set<Element>();
      document.querySelectorAll(".m-reveal").forEach((el) => {
        const parent = el.parentElement;
        const siblings = parent ? Array.from(parent.children).filter((child) => child.classList.contains("m-reveal")) : [];
        if (siblings.length > 1) {
          groups.add(parent!);
        }
        gsap.set(el, { y: 26 });
      });
      groups.forEach((parent) => {
        const items = Array.from(parent.children).filter((child) => child.classList.contains("m-reveal"));
        gsap.to(items, {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.08,
          scrollTrigger: { trigger: parent, start: "top 82%", once: true },
          onStart: () => items.forEach((item) => item.classList.add("is-visible")),
        });
      });
      document.querySelectorAll(".m-reveal").forEach((el) => {
        if (el.parentElement && groups.has(el.parentElement)) return;
        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 86%", once: true },
          onStart: () => el.classList.add("is-visible"),
        });
      });

      // 4) 卡片逐张入场
      document.querySelectorAll(".m-cards").forEach((row) => {
        const cards = row.querySelectorAll(".m-card");
        if (!cards.length) return;
        gsap.from(cards, {
          y: 22,
          opacity: 0,
          duration: 0.6,
          ease: "power3.out",
          stagger: 0.07,
          scrollTrigger: { trigger: row, start: "top 85%", once: true },
        });
      });

      // 5) 数据条数字滚动
      document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
        const target = Number(el.dataset.count);
        if (!Number.isFinite(target)) return;
        const suffix = el.dataset.countSuffix || "";
        const obj = { value: 0 };
        gsap.to(obj, {
          value: target,
          duration: 1.1,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
          onUpdate: () => { el.textContent = `${Math.round(obj.value)}${suffix}`; },
        });
      });

      // 6) 案例页对照行错位
      const rows = document.querySelectorAll(".m-compare-row");
      if (rows.length) {
        gsap.from(rows, {
          y: 14,
          opacity: 0,
          duration: 0.5,
          stagger: 0.06,
          ease: "power2.out",
          scrollTrigger: { trigger: ".m-compare", start: "top 85%", once: true },
        });
      }
    });

    // 兜底：动画结束后仍隐藏的内容直接显示；后台标签页（rAF 暂停）里数字直接落位
    const fallback = window.setTimeout(() => {
      document.querySelectorAll(".m-reveal").forEach((el) => el.classList.add("is-visible"));
      if (document.hidden) {
        gsap.set(".m-reveal, .m-card", { opacity: 1, y: 0 });
        document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
          const target = Number(el.dataset.count);
          if (Number.isFinite(target)) el.textContent = `${target}${el.dataset.countSuffix || ""}`;
        });
      }
    }, 2500);

    // 页面重新可见时重新测量（切标签、锁屏后回到页面）
    const onVisible = () => { if (!document.hidden) ScrollTrigger.refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(fallback);
      document.removeEventListener("visibilitychange", onVisible);
      ctx.revert();
      root.classList.remove("m-motion");
    };
  }, []);
}
