import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";

/**
 * Inertial scrolling for one scroll container (the Command center). Lenis and GSAP share one ticker.
 * Inner scrollers (transcript, event stream) opt out with `data-lenis-prevent`.
 * Skipped entirely for reduced-motion users, who keep the browser's native scrolling.
 */
export function useLenis(scrollerRef) {
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const lenis = new Lenis({ wrapper: el, content: el.firstElementChild, lerp: 0.09, smoothWheel: true });
    const tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [scrollerRef]);
}
