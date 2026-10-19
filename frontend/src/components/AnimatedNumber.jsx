import { useEffect, useRef } from "react";
import { animate } from "motion/react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts smoothly to a new value. Used for summary tiles only - risk scores are always shown exactly, never tweened. */
export default function AnimatedNumber({ value, decimals = 0 }) {
  const ref = useRef(null);
  const shown = useRef(typeof value === "number" ? value : 0);
  const fmt = (v) => (typeof v === "number" ? v.toFixed(decimals) : String(v));

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof value !== "number" || reduced()) {
      el.textContent = fmt(value);
      shown.current = typeof value === "number" ? value : 0;
      return undefined;
    }
    const controls = animate(shown.current, value, {
      duration: 0.5,
      ease: "easeOut",
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = fmt(v);
      },
      onComplete: () => {
        el.textContent = fmt(value);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  return <span ref={ref}>{fmt(value)}</span>;
}
