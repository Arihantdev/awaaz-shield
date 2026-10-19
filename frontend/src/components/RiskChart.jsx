import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

const H = 150, PAD = { l: 26, r: 8, t: 8, b: 14 };
const BANDS = [
  { at: 30, label: "30", color: "var(--risk-medium)" },
  { at: 55, label: "55", color: "var(--risk-high)" },
  { at: 80, label: "80", color: "var(--risk-critical)" },
];
const MAX_POINTS = 120;

function colorFor(s) {
  return s >= 80 ? "var(--risk-critical)" : s >= 55 ? "var(--risk-high)" : s >= 30 ? "var(--risk-medium)" : "var(--risk-low)";
}

export default function RiskChart({ history }) {
  const t = useT();
  const wrap = useRef(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pts = (history || []).slice(-MAX_POINTS);
  if (pts.length === 0) return <div ref={wrap}><div className="chart-empty">{t("chart.empty")}</div></div>;

  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (s) => PAD.t + ih - (Math.max(0, Math.min(100, s)) / 100) * ih;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const last = pts[pts.length - 1].score;
  const c = colorFor(last);
  const summary = t("chart.summary", { n: pts.length, last });

  return (
    <div ref={wrap} style={{ width: "100%" }}>
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={summary}>
      <defs>
        <linearGradient id="riskfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.35" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      {BANDS.map((b) => (
        <g key={b.at}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(b.at)} y2={y(b.at)} stroke={b.color} strokeOpacity="0.35" strokeDasharray="3 4" />
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
      <path d={area} fill="url(#riskfill)" />
      <path d={line} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.length < 40 && pts.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score)} r="3" fill="var(--bg)" stroke={colorFor(p.score)} strokeWidth="1.6">
          <title>{t("chart.point", { n: p.score })}</title>
        </circle>
      ))}
      {[0, ...BANDS.map((b) => b.at), 100].map((v) => (
        <text key={v} x={PAD.l - 5} y={y(v) + 3} textAnchor="end">{v}</text>
      ))}
    </svg>
    </div>
  );
}
