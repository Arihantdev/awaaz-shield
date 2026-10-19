import { memo, useEffect, useRef } from "react";
import { Mark } from "../components/TopBar";
import { LEVEL_HEX } from "../lib/risk";
import { prefersReducedMotion, useScene } from "./useScene";

/**
 * Compact 3D shield for the monitor screens. It is a readout, not decoration:
 *  - colour follows the call's current risk level (brand cyan when there is no call data yet)
 *  - the bars inside move with the microphone level while the operator is listening
 *  - the ring of signal points turns a little faster as risk rises
 *  - it tilts gently toward the pointer
 * It never receives or computes scores; it only reflects the level it is given. The canvas ignores pointer
 * events, pauses when off-screen or in a hidden tab (useScene), and renders one still frame for reduced motion.
 */
const BRAND = "#ff6a3d";

function shieldShape(THREE) {
  const s = new THREE.Shape();
  s.moveTo(0, 2.1);
  s.quadraticCurveTo(0.9, 1.72, 1.65, 1.72);
  s.lineTo(1.65, 0.3);
  s.bezierCurveTo(1.65, -0.9, 0.8, -1.7, 0, -2.15);
  s.bezierCurveTo(-0.8, -1.7, -1.65, -0.9, -1.65, 0.3);
  s.lineTo(-1.65, 1.72);
  s.quadraticCurveTo(-0.9, 1.72, 0, 2.1);
  return s;
}

function ShieldCore({ level = null, listening = false, levelRef = null, className = "" }) {
  const state = useRef({ level, listening });
  state.current = { level, listening };
  const touchRef = useRef(null);

  const { hostRef, ok } = useScene(({ THREE, scene, camera }) => {
    const reduced = prefersReducedMotion();
    const group = new THREE.Group();
    scene.add(group);
    const ADD = THREE.AdditiveBlending;

    const geo = new THREE.ExtrudeGeometry(shieldShape(THREE), {
      depth: 0.3, curveSegments: 24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2,
    });
    geo.center();
    const faceMat = new THREE.MeshBasicMaterial({ color: BRAND, transparent: true, opacity: 0.12, depthWrite: false });
    const edgeMat = new THREE.LineBasicMaterial({ color: BRAND, transparent: true, opacity: 0.95 });
    group.add(new THREE.Mesh(geo, faceMat));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat));

    // soft halo: two enlarged copies of the shield, additive, so the rim seems to glow
    const haloMats = [0.1, 0.045].map((o) => new THREE.MeshBasicMaterial({ color: BRAND, transparent: true, opacity: o, depthWrite: false, blending: ADD, side: THREE.BackSide }));
    [1.1, 1.26].forEach((k, i) => {
      const m = new THREE.Mesh(geo, haloMats[i]);
      m.scale.setScalar(k);
      group.add(m);
    });

    // inner core: a smaller, brighter shield that breathes
    const coreMat = new THREE.MeshBasicMaterial({ color: BRAND, transparent: true, opacity: 0.16, depthWrite: false, blending: ADD });
    const core = new THREE.Mesh(geo, coreMat);
    core.scale.set(0.78, 0.78, 0.5);
    group.add(core);

    // voice bars inside the shield
    const BARS = 7;
    const barMat = new THREE.MeshBasicMaterial({ color: BRAND, transparent: true, opacity: 0.95 });
    const barGeo = new THREE.BoxGeometry(0.17, 1, 0.1);
    const bars = Array.from({ length: BARS }, (_, i) => {
      const m = new THREE.Mesh(barGeo, barMat);
      m.position.set((i - (BARS - 1) / 2) * 0.36, 0, 0.26);
      group.add(m);
      return m;
    });

    // scan line sweeping over the face
    const scanMat = new THREE.MeshBasicMaterial({ color: BRAND, transparent: true, opacity: 0.55, depthWrite: false, blending: ADD });
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.035), scanMat);
    scan.position.z = 0.24;
    group.add(scan);

    // two counter-rotating rings of signal points
    const makeRing = (n, rad, wobble, size, opacity, tilt) => {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = rad + ((i * 7919) % 13) * 0.012;
        pos.set([Math.cos(a) * r, Math.sin(a * 3) * wobble, Math.sin(a) * r], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ color: BRAND, size, transparent: true, opacity, depthWrite: false, blending: ADD });
      const pts = new THREE.Points(g, m);
      pts.rotation.x = tilt;
      group.add(pts);
      return { pts, mat: m, base: opacity };
    };
    const ringA = makeRing(150, 2.75, 0.1, 0.06, 0.6, 0.35);
    const ringB = makeRing(220, 3.35, 0.16, 0.045, 0.4, -0.55);

    // a few bright sparks orbiting on their own paths
    const SPARKS = 9;
    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ color: "#ffffff", size: 0.14, transparent: true, opacity: 0.9, depthWrite: false, blending: ADD });
    group.add(new THREE.Points(sparkGeo, sparkMat));

    // shockwave: one ring that expands and fades whenever the risk level changes
    const waveMat = new THREE.MeshBasicMaterial({ color: BRAND, transparent: true, opacity: 0, depthWrite: false, blending: ADD, side: THREE.DoubleSide });
    const wave = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), waveMat);
    wave.position.z = -0.2;
    scene.add(wave);

    const colors = {
      idle: new THREE.Color(BRAND),
      low: new THREE.Color(LEVEL_HEX.low),
      medium: new THREE.Color(LEVEL_HEX.medium),
      high: new THREE.Color(LEVEL_HEX.high),
      critical: new THREE.Color(LEVEL_HEX.critical),
    };
    const cur = new THREE.Color(BRAND);
    const bright = new THREE.Color();
    const white = new THREE.Color("#ffffff");
    let lvlSmooth = 0;
    let lastLevel = state.current.level;
    let waveT = -1;
    const pointer = { x: 0, y: 0 };
    const onMove = (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (!reduced) window.addEventListener("pointermove", onMove, { passive: true });

    const setDistance = (w, h) => { camera.position.z = Math.max(8.2, 9.6 / Math.min(1, w / h)); };
    setDistance(1, 1);
    const PULSE_HZ = { low: 0.5, medium: 0.8, high: 1.3, critical: 2.1 };

    return {
      resize: setDistance,
      setTouch: (fn) => { touchRef.current = fn; },
      update: (t, dt) => {
        const s = state.current;
        const target = colors[s.level] || colors.idle;
        if (reduced) cur.copy(target); else cur.lerp(target, 1 - Math.exp(-dt * 4));
        bright.copy(cur).lerp(white, 0.35);
        [faceMat, edgeMat, barMat, ringA.mat, ringB.mat, scanMat, waveMat].forEach((m) => m.color.copy(cur));
        coreMat.color.copy(bright);
        haloMats.forEach((m) => m.color.copy(cur));

        if (s.level !== lastLevel) {
          if (!reduced && s.level) waveT = 0;
          lastLevel = s.level;
        }

        const raw = s.listening && levelRef ? levelRef.current : 0;
        lvlSmooth += (raw - lvlSmooth) * Math.min(1, dt * 12);
        bars.forEach((b, i) => {
          const rest = 0.22 + 0.05 * Math.sin(t * 1.1 + i * 0.9);
          const live = s.listening ? lvlSmooth * (0.55 + 0.45 * Math.sin(t * 9 + i * 1.7)) * 1.5 : 0;
          b.scale.y = Math.max(0.08, reduced ? 0.3 : rest + live);
        });

        const hz = PULSE_HZ[s.level] ?? 0.4;
        const beat = reduced ? 0 : Math.sin(t * Math.PI * 2 * hz);
        const urgency = s.level === "critical" ? 1 : s.level === "high" ? 0.6 : s.level === "medium" ? 0.25 : 0;
        group.scale.setScalar(1 + beat * (0.012 + urgency * 0.02) + lvlSmooth * 0.03);
        coreMat.opacity = 0.14 + 0.07 * (beat * 0.5 + 0.5) + urgency * 0.1 + lvlSmooth * 0.12;
        haloMats[0].opacity = 0.09 + urgency * 0.07 + 0.04 * (beat * 0.5 + 0.5);
        haloMats[1].opacity = 0.04 + urgency * 0.04;

        if (!reduced) {
          const spin = 0.22 + urgency * 0.2;
          ringA.pts.rotation.y += dt * spin;
          ringB.pts.rotation.y -= dt * spin * 0.65;
          group.rotation.y += (pointer.x * 0.45 + Math.sin(t * 0.4) * 0.12 - group.rotation.y) * Math.min(1, dt * 3);
          group.rotation.x += (pointer.y * 0.2 - group.rotation.x) * Math.min(1, dt * 3);

          const sy = Math.sin(t * (0.7 + urgency * 0.5)) * 1.85 - 0.1;
          scan.position.y = sy;
          scan.scale.x = 2 * 1.55 * Math.min(1, Math.sqrt(Math.max(0.04, (sy + 2.1) / 2.4)));
          scanMat.opacity = 0.25 + 0.3 * (1 - Math.abs(sy) / 2);

          for (let i = 0; i < SPARKS; i++) {
            const a = t * (0.35 + (i % 3) * 0.12) * (i % 2 ? 1 : -1) + i * 0.7;
            const r = 2.2 + (i % 4) * 0.34;
            sparkPos.set([Math.cos(a) * r, Math.sin(a * 1.7 + i) * 1.5, Math.sin(a) * r * 0.6], i * 3);
          }
          sparkGeo.attributes.position.needsUpdate = true;

          if (waveT >= 0) {
            waveT += dt / 1.3;
            const k = Math.min(waveT, 1);
            wave.scale.setScalar(2.1 + k * 2.6);
            waveMat.opacity = (1 - k) * 0.7;
            if (k >= 1) { waveT = -1; waveMat.opacity = 0; }
          }
        } else {
          scanMat.opacity = 0;
        }
        const live = 0.5 + 0.35 * lvlSmooth;
        ringA.mat.opacity = live;
        ringB.mat.opacity = live * 0.65;
      },
      dispose: () => window.removeEventListener("pointermove", onMove),
    };
  }, []);

  // reduced motion renders a single frame, so ask for another one when the level changes
  useEffect(() => { touchRef.current?.(); }, [level, listening]);

  if (!ok) {
    return <div className={`shield-core shield-fallback ${className}`} aria-hidden="true"><Mark size={64} /></div>;
  }
  return <div ref={hostRef} className={`shield-core ${className}`} aria-hidden="true" />;
}

export default memo(ShieldCore);
