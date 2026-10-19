import { useEffect, useRef } from "react";
import gsap from "gsap";

const INTERACTIVE = "a,button,input,select,textarea,[data-cursor]";

/** Soft glow that follows the pointer while the Command center is open. Off for touch and reduced motion. */
export default function GlowCursor() {
  const halo = useRef(null);
  const dot = useRef(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const h = halo.current;
    const d = dot.current;
    gsap.set([h, d], { xPercent: -50, yPercent: -50, x: -200, y: -200, opacity: 0 });
    const hx = gsap.quickTo(h, "x", { duration: 0.45, ease: "power3" });
    const hy = gsap.quickTo(h, "y", { duration: 0.45, ease: "power3" });
    const dx = gsap.quickTo(d, "x", { duration: 0.08, ease: "none" });
    const dy = gsap.quickTo(d, "y", { duration: 0.08, ease: "none" });
    let shown = false;
    const move = (e) => {
      if (!shown) {
        shown = true;
        gsap.to([h, d], { opacity: 1, duration: 0.3 });
      }
      hx(e.clientX); hy(e.clientY); dx(e.clientX); dy(e.clientY);
      const over = e.target instanceof Element && e.target.closest(INTERACTIVE);
      gsap.to(h, { scale: over ? 0.55 : 1, duration: 0.3, overwrite: "auto" });
      gsap.to(d, { scale: over ? 2.4 : 1, duration: 0.25, overwrite: "auto" });
    };
    const leave = () => {
      shown = false;
      gsap.to([h, d], { opacity: 0, duration: 0.25 });
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      gsap.killTweensOf([h, d]);
    };
  }, []);

  return (
    <>
      <div ref={halo} className="cc-halo" aria-hidden="true" />
      <div ref={dot} className="cc-dot" aria-hidden="true" />
    </>
  );
}
