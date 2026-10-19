import { useEffect, useRef } from "react";
import { LEVEL_HEX } from "../lib/risk";
import { micLevel } from "../lib/micLevel";

/**
 * Thin live-signal ribbon (canvas 2D). Layered sine waves that flatten when the line is idle and swell with
 * the microphone level; the colour follows the risk level. Decorative (aria-hidden), pauses when the tab is
 * hidden, draws a single still frame for reduced motion.
 */
export default function SignalWave({ level = "low", active = false, height = 44 }) {
  const ref = useRef(null);
  const props = useRef({ level, active });
  props.current = { level, active };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, amp = 0.15, w = 0, h = 0;

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (ms) => {
      const t = ms / 1000;
      const { level: lv, active: on } = props.current;
      amp += ((on ? 0.25 + micLevel.current * 1.4 : 0.12) - amp) * 0.08;
      ctx.clearRect(0, 0, w, h);
      const color = LEVEL_HEX[lv] || "#ff6a3d";
      [[1, 0.9, 1.0], [1.7, 0.5, 0.55], [2.6, 0.3, 0.3]].forEach(([freq, phase, alpha], k) => {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 3) {
          const nx = x / w, env = Math.sin(Math.PI * nx); // calm at both ends
          const y = h / 2 + Math.sin(nx * 9 * freq + t * (1.6 + k * 0.7) + phase) * env * amp * (h / 2) * (1 - k * 0.2);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = k === 0 ? 2 : 1.2;
        ctx.shadowColor = color; ctx.shadowBlur = k === 0 ? 8 : 0;
        ctx.stroke();
      });
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (!reduced && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    fit();
    start();
    const ro = new ResizeObserver(() => { fit(); if (reduced) draw(0); });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", start);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", start); };
  }, []);

  return <canvas ref={ref} className="signal-wave" style={{ height }} aria-hidden="true" />;
}
