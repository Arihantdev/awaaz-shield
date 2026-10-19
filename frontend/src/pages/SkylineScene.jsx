import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";

const HEX = { low: "#5fb98a", medium: "#d9b04c", high: "#f0913f", critical: "#f0606a" };
const H = 4; // world height of a score of 100
const STEP = 1.5;

/** One call = one bar. Grows in once, brightens on hover, dims when a filter excludes it. */
function Bar({ item, x, z, dim, hovered, onHover, onPick, animate, tipText }) {
  const group = useRef();
  const h = Math.max(0.12, (item.peak / 100) * H);
  useEffect(() => { if (animate && group.current) group.current.scale.y = 0.001; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const target = 1;
    g.scale.y += (target - g.scale.y) * (animate ? 0.1 : 1);
  });
  return (
    <group ref={group} position={[x, 0, z]}>
      <mesh
        position={[0, h / 2, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(item.id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); onPick(item.id); }}
      >
        <boxGeometry args={[0.95, h, 0.95]} />
        <meshStandardMaterial
          color={HEX[item.level]}
          emissive={HEX[item.level]}
          emissiveIntensity={hovered ? 0.55 : 0.12}
          roughness={0.45}
          metalness={0.1}
          transparent
          opacity={dim ? 0.14 : 1}
        />
      </mesh>
      {item.needs && !dim && (
        <mesh position={[0, h + 0.28, 0]}>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshBasicMaterial color={HEX[item.level]} />
        </mesh>
      )}
      {hovered && (
        <Html position={[0, h + 0.7, 0]} center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
          <div className="sky-tip">
            <b>{item.label}</b>
            <span>{tipText}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

function Bands({ size }) {
  // faint floors at the score where each level starts (30, 55, 80)
  const marks = [[30, HEX.medium], [55, HEX.high], [80, HEX.critical]];
  return marks.map(([score, color]) => (
    <mesh key={score} rotation={[-Math.PI / 2, 0, 0]} position={[0, (score / 100) * H, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color={color} transparent opacity={0.05} depthWrite={false} side={2} />
    </mesh>
  ));
}

export default function SkylineScene({ rows, dimmed, onPick, resetKey, reduced, tip }) {
  const [hover, setHover] = useState(null);
  const controls = useRef();
  const cols = Math.max(1, Math.ceil(Math.sqrt(rows.length)));
  const rowsN = Math.ceil(rows.length / cols);
  const size = Math.max(cols, rowsN) * STEP + 3;
  const pos = useMemo(
    () => rows.map((r, i) => ({ r, x: (i % cols - (cols - 1) / 2) * STEP, z: (Math.floor(i / cols) - (rowsN - 1) / 2) * STEP })),
    [rows, cols, rowsN]
  );
  const dist = size * 0.95 + 4;

  useEffect(() => { controls.current?.reset(); }, [resetKey]);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [dist * 0.75, dist * 0.6, dist * 0.75], fov: 38 }}
      gl={{ antialias: true, powerPreference: "low-power" }}
      style={{ cursor: hover ? "pointer" : "grab" }}
      onPointerMissed={() => setHover(null)}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 12, 8]} intensity={1.4} />
      <directionalLight position={[-8, 6, -6]} intensity={0.4} />
      <gridHelper args={[size, Math.round(size / STEP), "#3d3d43", "#232327"]} />
      <Bands size={size} />
      {pos.map(({ r, x, z }) => (
        <Bar
          key={r.id}
          item={r}
          x={x}
          z={z}
          dim={dimmed.has(r.id)}
          hovered={hover === r.id}
          onHover={setHover}
          onPick={onPick}
          animate={!reduced}
          tipText={tip(r)}
        />
      ))}
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        enableDamping
        autoRotate={!reduced && !hover}
        autoRotateSpeed={0.7}
        minDistance={4}
        maxDistance={dist * 2.2}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, H / 3, 0]}
      />
    </Canvas>
  );
}
