import { memo, useEffect, useRef } from "react";
import { LEVEL_HEX } from "../lib/risk";
import { COLS, RIDGES } from "../lib/riskLandscape";
import { prefersReducedMotion, useScene } from "./useScene";

/**
 * Risk landscape: a wireframe terrain where each ridge is one call's risk over its own timeline.
 * It only draws the heights and levels it is given (see lib/riskLandscape.js); it never scores anything.
 * Ridge colour follows that call's level, and the selected call's ridge is brighter. Heights ease toward
 * new values, or snap when the user prefers reduced motion.
 */
const W = 11;
const D = 5.2;
const IDLE = "#3a3a40";

function RiskLandscape({ data, className = "" }) {
  const state = useRef(data);
  state.current = data;
  const touchRef = useRef(null);

  const { hostRef, ok } = useScene(({ THREE, scene, camera }) => {
    camera.fov = 38;
    camera.near = 0.1;
    camera.far = 60;
    camera.position.set(0, 3.5, 6.6);
    camera.lookAt(0, 0.3, 0);
    camera.updateProjectionMatrix();

    const n = RIDGES * COLS;
    const pos = new Float32Array(n * 3);
    for (let r = 0; r < RIDGES; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = (r * COLS + c) * 3;
        pos[i] = (c / (COLS - 1) - 0.5) * W;
        pos[i + 2] = (r / (RIDGES - 1) - 0.5) * D;
      }
    }
    const idx = [];
    for (let r = 0; r < RIDGES; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * COLS + c;
        if (c < COLS - 1) idx.push(a, a + 1);
        if (r < RIDGES - 1 && c % 4 === 0) idx.push(a, a + COLS);
      }
    }
    const geo = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(pos, 3);
    const color = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute("position", position);
    geo.setAttribute("color", color);
    geo.setIndex(idx);
    scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));

    const reduced = prefersReducedMotion();
    const cur = new Float32Array(n);
    const idle = new THREE.Color(IDLE);
    const tint = Object.fromEntries(Object.entries(LEVEL_HEX).map(([k, v]) => [k, new THREE.Color(v)]));
    const tmp = new THREE.Color();

    const paint = (dt) => {
      const { heights, levels, selectedRow } = state.current;
      const k = reduced ? 1 : 1 - Math.exp(-dt * 6);
      for (let r = 0; r < RIDGES; r++) {
        const base = levels[r] ? tint[levels[r]] : idle;
        const depth = 0.45 + 0.55 * (r / (RIDGES - 1));
        const boost = r === selectedRow ? 1.5 : 1;
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          cur[i] += (heights[i] - cur[i]) * k;
          position.setY(i, cur[i] * 2.1);
          const b = levels[r] ? Math.min(1, (0.3 + cur[i] * 1.1) * depth * boost) : 0.35 * depth;
          tmp.copy(idle).multiplyScalar(0.5).lerp(base, b);
          color.setXYZ(i, tmp.r, tmp.g, tmp.b);
        }
      }
      position.needsUpdate = true;
      color.needsUpdate = true;
    };

    return {
      update: (_t, dt) => paint(dt),
      setTouch: (fn) => { touchRef.current = fn; },
    };
  }, []);

  // With reduced motion there is no render loop, so draw again whenever the data changes.
  useEffect(() => { touchRef.current?.(); }, [data]);

  if (!ok) return <div className={`cc-3d-fallback ${className}`} role="img" aria-label="3D view unavailable" />;
  return <div ref={hostRef} className={`cc-3d ${className}`} aria-hidden="true" />;
}

export default memo(RiskLandscape);
