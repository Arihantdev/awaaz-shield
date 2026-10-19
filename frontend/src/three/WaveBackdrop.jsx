import { useRef } from "react";
import { LEVEL_HEX } from "../lib/risk";
import { micLevel } from "../lib/micLevel";
import { prefersReducedMotion, useScene } from "./useScene";

/**
 * Dashboard backdrop: the same particle waveform terrain as the login screen, drifting slowly behind the
 * workspace. It is a readout as well as decoration: the colour follows the risk level on screen and the
 * swell grows with risk and with the microphone level. Pointer events pass straight through it, it pauses
 * when hidden or off-screen (useScene) and shows one still frame for reduced motion.
 */
const VERT = /* glsl */ `
  uniform float uTime; uniform float uAmp; uniform float uPx;
  uniform vec2 uMouse; uniform float uRip; uniform float uPulse;
  varying float vH; varying float vFade; varying float vRip;
  void main(){
    vec3 p = position;
    float w = sin(p.x*.45 + uTime*.7) * .5 + sin(p.z*.55 - uTime*.5 + p.x*.18) * .4 + sin((p.x+p.z)*.9 + uTime*1.3) * .12;
    // ripple spreading from the pointer
    float d = length(p.xz - uMouse);
    float rip = sin(d*1.6 - uTime*4.0) * exp(-d*.22) * uRip;
    // a swell that travels away from the camera when the risk level changes (uPulse runs 0..1, 2 = idle)
    float front = uPulse * 34.0;
    float band = exp(-pow((-p.z - front) * .22, 2.0)) * (1.0 - smoothstep(0.85, 1.0, uPulse)) * step(uPulse, 1.0);
    p.y += (w + rip) * uAmp + band * 2.4;
    vH = w + rip * .8 + band * 1.2;
    vRip = abs(rip) + band;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (1.0 + vRip * .9) / -mv.z;
    vFade = smoothstep(46., 8., -mv.z);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uColor2; uniform float uShift;
  varying float vH; varying float vFade; varying float vRip;
  void main(){
    float d = length(gl_PointCoord - .5); if (d > .5) discard;
    float crest = smoothstep(-.2, .9, vH);
    // crests drift toward the second colour, and the drift slowly breathes over time
    vec3 col = mix(uColor, uColor2, clamp(crest * uShift + vRip * .5, 0., 1.));
    gl_FragColor = vec4(col, smoothstep(.5, .1, d) * vFade * (.25 + .6 * crest + .4 * vRip));
  }
`;

export default function WaveBackdrop({ level = null }) {
  const state = useRef({ level });
  state.current = { level };

  const { hostRef, ok } = useScene(({ THREE, scene, camera, renderer }) => {
    const COLS = 190, ROWS = 90, SP = 0.36;
    const pos = new Float32Array(COLS * ROWS * 3);
    let i = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      pos[i++] = (c - COLS / 2) * SP; pos[i++] = 0; pos[i++] = -r * SP;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const uniforms = {
      uTime: { value: 0 }, uAmp: { value: 0.8 }, uPx: { value: 150 * renderer.getPixelRatio() },
      uColor: { value: new THREE.Color("#ff6a3d") },
      uColor2: { value: new THREE.Color("#ffc14d") },
      uShift: { value: 0.5 },
      uMouse: { value: new THREE.Vector2(0, -12) }, uRip: { value: 0 }, uPulse: { value: 2 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    scene.add(new THREE.Points(geo, mat));
    camera.position.set(0, 5.5, 7);
    camera.lookAt(0, 0, -14);

    const target = new THREE.Color();
    const target2 = new THREE.Color();
    const white = new THREE.Color("#ffffff");
    let amp = 0.8;
    let lastLevel = state.current.level;
    let pulse = 2;
    let rip = 0;
    const mouse = { x: 0, y: 0, moved: 0 };
    const reduced = prefersReducedMotion();
    const onMove = (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      mouse.moved = 1;
    };
    if (!reduced) window.addEventListener("pointermove", onMove, { passive: true });
    return {
      dispose() { window.removeEventListener("pointermove", onMove); },
      update(t, dt = 0.016) {
        const lvl = state.current.level;
        target.set(lvl ? LEVEL_HEX[lvl] : "#ff6a3d");
        uniforms.uColor.value.lerp(target, 0.05);
        // second colour: a lighter, warmer version of the risk colour
        target2.copy(target).lerp(white, 0.35);
        if (!lvl || lvl === "low") target2.set("#ffc14d");
        uniforms.uColor2.value.lerp(target2, 0.05);
        uniforms.uShift.value = 0.45 + 0.35 * Math.sin(t * 0.25);
        if (lvl !== lastLevel) { if (!reduced) pulse = 0; lastLevel = lvl; }
        if (pulse < 1) pulse += dt / 3.2; else pulse = 2;
        uniforms.uPulse.value = pulse;
        rip += ((mouse.moved ? 0.55 : 0) - rip) * 0.05;
        mouse.moved *= 0.97;
        uniforms.uRip.value = reduced ? 0 : rip;
        uniforms.uMouse.value.set(mouse.x * 22, -6 - (mouse.y * 0.5 + 0.5) * 22);
        const risk = { low: 0.8, medium: 1.1, high: 1.5, critical: 1.9 }[lvl] ?? 0.8;
        amp += (risk + micLevel.current * 1.6 - amp) * 0.06;
        uniforms.uAmp.value = amp;
        uniforms.uTime.value = t;
      },
      resize() { uniforms.uPx.value = 150 * renderer.getPixelRatio(); },
    };
  }, []);

  if (!ok) return null;
  return <div className="wave-backdrop" ref={hostRef} aria-hidden="true" />;
}
