import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Shared Three.js lifecycle: renderer, resize, pause when hidden/offscreen, full dispose.
 * `build({ THREE, scene, camera, renderer, width, height })` returns { update(t, dt), resize?(w,h), dispose?() }.
 * Returns { hostRef, ok } - render <div ref={hostRef}> and show a fallback when ok === false.
 */
export function useScene(build, deps = [], options = {}) {
  const hostRef = useRef(null);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (!webglAvailable()) {
      setOk(false);
      return undefined;
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setOk(false);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const size = () => ({ w: Math.max(host.clientWidth, 1), h: Math.max(host.clientHeight, 1) });
    let { w, h } = size();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const api = build({ THREE, scene, camera, renderer, width: w, height: h });
    // optional post-processing owned here so there is exactly one render loop / resize / dispose path
    let post = null;
    if (options.post) {
      try {
        post = options.post(renderer, scene, camera);
        post?.setSize(w, h);
      } catch {
        post = null; // fall back to the plain renderer
      }
    }
    const reduced = prefersReducedMotion();
    let last = performance.now();
    let elapsed = 0;
    let raf = 0;
    let visible = true;
    let inView = true;

    const frame = () => {
      raf = 0;
      if (!visible || !inView) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;
      api.update(elapsed, dt);
      if (post && post.active !== false) post.render(dt);
      else renderer.render(scene, camera);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onResize = () => {
      ({ w, h } = size());
      renderer.setSize(w, h, false);
      post?.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      api.resize?.(w, h);
      if (reduced) frame();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      if (inView) start();
    });
    io.observe(host);
    const onVis = () => {
      visible = !document.hidden;
      if (visible) start();
    };
    document.addEventListener("visibilitychange", onVis);

    // reduced motion: render one still frame (and re-render when props change via api.touch)
    frame();
    if (!reduced) start();
    const touch = () => reduced && frame();
    api.setTouch?.(touch);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      api.dispose?.();
      post?.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { hostRef, ok };
}
