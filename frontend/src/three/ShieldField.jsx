import gsap from "gsap";
import { useScene, prefersReducedMotion } from "./useScene";
import { createBloom } from "./bloom";

/**
 * Login scene. A particle terrain (an audio waveform seen from above) lifts off and assembles into the
 * Awaaz Shield mark: shield, microphone and its holder. GSAP drives one timeline (morph + camera dolly);
 * the shader does the rest. Decorative only. useScene owns the renderer, loop, resize and dispose.
 */
const VERT = /* glsl */ `
  attribute vec3 aTarget; attribute vec2 aMeta;
  uniform float uTime; uniform float uMorph; uniform float uPx;
  varying float vType; varying float vA;
  float wave(vec3 p, float t){ return sin(p.x*.5+t*.8)*.35 + sin(p.z*.6-t*.6+p.x*.2)*.3; }
  void main(){
    float seed = aMeta.x, type = aMeta.y;
    vec3 src = position; src.y += wave(src, uTime);
    float m = type < .5 ? 0. : smoothstep(0., 1., clamp(uMorph*1.4 - seed*.4, 0., 1.));
    vec3 tgt = aTarget + vec3(sin(uTime*.9+seed*40.), cos(uTime*.7+seed*30.), sin(uTime*.8+seed*20.)) * (type > 2.5 ? .004 : .012);
    vec3 p = mix(src, tgt, m);
    float arc = sin(m*3.14159);
    p.y += arc * (1.2 + seed*2.2) * (type < .5 ? 0. : 1.);
    p.x += arc * (seed-.5) * 2.4;
    p.z += arc * (fract(seed*7.)-.5) * 2.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * mv;
    float size = type > 2.5 ? 2.5 : (type > 1.5 ? 1.9 : (type > .5 ? 1.15 : 1.0));
    gl_PointSize = uPx * size / -mv.z;
    vType = type;
    vA = (type < .5 ? .5 : 1.) * smoothstep(34., 7., -mv.z);
  }
`;
const FRAG = /* glsl */ `
  varying float vType; varying float vA;
  void main(){
    float d = length(gl_PointCoord - .5); if (d > .5) discard;
    vec3 col = vType < .5 ? vec3(.30,.09,.04) : (vType < 1.5 ? vec3(.55,.17,.07) : (vType < 2.5 ? vec3(.95,.42,.22) : vec3(1.0,.86,.74)));
    float a = smoothstep(.5, .08, d) * vA * (vType > 1.5 ? .85 : .5);
    gl_FragColor = vec4(col, a);
  }
`;

function shieldPoints(THREE) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 2.1);
  shape.quadraticCurveTo(0.9, 1.72, 1.65, 1.72);
  shape.lineTo(1.65, 0.3);
  shape.bezierCurveTo(1.65, -0.9, 0.8, -1.7, 0, -2.15);
  shape.bezierCurveTo(-0.8, -1.7, -1.65, -0.9, -1.65, 0.3);
  shape.lineTo(-1.65, 1.72);
  shape.quadraticCurveTo(-0.9, 1.72, 0, 2.1);
  const poly = shape.getSpacedPoints(240);
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const out = []; // {x,y,z,type}
  let n = 0;
  while (n < 5200) {
    const x = (Math.random() - 0.5) * 3.4, y = (Math.random() - 0.5) * 4.4;
    if (inside(x, y)) { out.push([x, y, (Math.random() - 0.5) * 0.35, 1]); n++; }
  }
  shape.getSpacedPoints(1700).forEach((p) => out.push([p.x + (Math.random() - 0.5) * 0.03, p.y + (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.4, 2]));
  // microphone: capsule + holder arc + stem + base
  const cap = (x, y, zz) => out.push([x, y + 0.35, zz, 3]);
  for (let i = 0; i < 520; i++) { // capsule fill
    const x = (Math.random() - 0.5) * 0.52, y = (Math.random() - 0.5) * 1.1;
    const dy = Math.max(0, Math.abs(y) - 0.29);
    if (Math.hypot(x, dy) <= 0.26) cap(x, y, 0.28 + Math.random() * 0.06);
  }
  for (let i = 0; i < 360; i++) { // capsule outline
    const t = Math.random() * Math.PI * 2, top = Math.sin(t) > 0 ? 0.29 : -0.29;
    cap(Math.cos(t) * 0.26, Math.sin(t) * 0.26 + top, 0.3);
  }
  for (let i = 0; i < 300; i++) { const a = Math.PI * (1.08 + Math.random() * 0.84); out.push([Math.cos(a) * 0.62, 0.28 + Math.sin(a) * 0.62, 0.3, 3]); }
  for (let i = 0; i < 90; i++) out.push([(Math.random() - 0.5) * 0.03, -0.34 - Math.random() * 0.36, 0.3, 3]);
  for (let i = 0; i < 90; i++) out.push([(Math.random() - 0.5) * 0.62, -0.7 + (Math.random() - 0.5) * 0.03, 0.3, 3]);
  return out;
}

export default function ShieldField() {
  const { hostRef, ok } = useScene(({ THREE, scene, camera, renderer }) => {
    const shield = shieldPoints(THREE);
    const GROUND = 4800;
    const N = shield.length + GROUND;
    const pos = new Float32Array(N * 3), tgt = new Float32Array(N * 3), meta = new Float32Array(N * 2);
    shield.forEach((s, i) => {
      pos.set([(Math.random() - 0.5) * 32, -2.7, 3 - Math.random() * 17], i * 3);
      tgt.set([s[0], s[1], s[2]], i * 3);
      meta.set([Math.random(), s[3]], i * 2);
    });
    for (let i = shield.length; i < N; i++) {
      const x = (Math.random() - 0.5) * 34, z = 3 - Math.random() * 17;
      pos.set([x, -2.7, z], i * 3);
      tgt.set([x, -2.7, z], i * 3);
      meta.set([Math.random(), 0], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aTarget", new THREE.BufferAttribute(tgt, 3));
    geo.setAttribute("aMeta", new THREE.BufferAttribute(meta, 2));
    const uniforms = { uTime: { value: 0 }, uMorph: { value: 0 }, uPx: { value: renderer.getPixelRatio() * 18 } };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);

    camera.position.set(0, 0.2, 7.8);
    camera.lookAt(0, -0.2, 0);

    const reduced = prefersReducedMotion();
    let tl = null;
    if (reduced) {
      uniforms.uMorph.value = 1;
    } else {
      camera.position.set(0, 1.4, 11);
      tl = gsap.timeline();
      tl.to(uniforms.uMorph, { value: 1, duration: 3.4, ease: "power3.inOut", delay: 0.35 }, 0);
      tl.to(camera.position, { y: 0.2, z: 7.8, duration: 4.2, ease: "power2.out" }, 0);
    }

    const mouse = { x: 0, y: 0 };
    const onMove = (e) => { mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = (e.clientY / window.innerHeight) * 2 - 1; };
    window.addEventListener("pointermove", onMove, { passive: true });
    let base = { x: 0, y: 0 };
    const place = (w, h) => {
      const aspect = w / h;
      uniforms.uPx.value = renderer.getPixelRatio() * Math.min(22, Math.max(12, h * 0.02));
      const halfW = Math.tan((camera.fov * Math.PI) / 360) * 7.8 * aspect;
      base = aspect > 1.15 ? { x: -halfW * 0.5, y: 0.55 } : { x: 0, y: 2.1 };
      points.scale.setScalar(aspect > 1.15 ? 1 : 0.6);
    };
    place(renderer.domElement.clientWidth || 1200, renderer.domElement.clientHeight || 800);

    return {
      resize: place,
      update: (t) => {
        uniforms.uTime.value = t;
        points.position.x += (base.x - points.position.x) * 0.1;
        points.position.y += (base.y - points.position.y) * 0.1;
        if (!reduced) {
          points.rotation.y += (mouse.x * 0.28 - points.rotation.y) * 0.04;
          points.rotation.x += (mouse.y * 0.12 - points.rotation.x) * 0.04;
        }
      },
      dispose: () => {
        tl?.kill();
        window.removeEventListener("pointermove", onMove);
      },
    };
  }, [], { post: createBloom });

  if (!ok) return <div className="wave-fallback" aria-hidden="true" />;
  return <div ref={hostRef} className="three-host" aria-hidden="true" />;
}
