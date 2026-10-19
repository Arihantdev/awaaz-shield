import { useEffect } from "react";

const TARGETS = ".card, .tile, .stage > .block, .stage > .summary, .side > .block, .login-card";

/**
 * Cursor spotlight for cards: one pointer listener writes --mx / --my (pixels inside the card under the
 * pointer) and the stylesheet paints the glow from them. Does nothing on touch screens or with reduced motion.
 */
export default function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let raf = 0;
    let ev = null;
    const apply = () => {
      raf = 0;
      const el = ev?.target instanceof Element ? ev.target.closest(TARGETS) : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      el.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    const onMove = (e) => {
      ev = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
}
