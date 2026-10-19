import { motion, useReducedMotion } from "motion/react";
import { LEVELS, LEVEL_HEX, THRESHOLDS } from "../lib/risk";
import { useT } from "../i18n";

// Half-circle gauge: 0 on the left, 100 on the right. The number is always the exact score;
// only the arc animates, and it settles in well under a second.
const CX = 110, CY = 108, R = 88;
const point = (v, r) => {
  const a = Math.PI * (1 - v / 100);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};
const ARC = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
const RANGES = {
  low: `0–${THRESHOLDS.medium - 1}`,
  medium: `${THRESHOLDS.medium}–${THRESHOLDS.high - 1}`,
  high: `${THRESHOLDS.high}–${THRESHOLDS.critical - 1}`,
  critical: `${THRESHOLDS.critical}–100`,
};

export default function RiskGauge({ score, level }) {
  const t = useT();
  const reduce = useReducedMotion();
  const color = LEVEL_HEX[level];
  const levelName = t(`level.${level}`);

  return (
    <figure className={`gauge risk-${level}`}>
      <svg viewBox="0 0 220 124" role="img" aria-label={t("gauge.aria", { score, level: levelName })}>
        <path d={ARC} className="gauge-track" />
        <motion.path
          d={ARC}
          className="gauge-value"
          initial={false}
          animate={{ pathLength: score / 100, opacity: score > 0 ? 1 : 0, stroke: color }}
          transition={{ duration: reduce ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
        {[THRESHOLDS.medium, THRESHOLDS.high, THRESHOLDS.critical].map((v) => {
          const [x1, y1] = point(v, R - 9);
          const [x2, y2] = point(v, R + 9);
          return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} className="gauge-tick" />;
        })}
        <text x={CX} y={CY - 16} textAnchor="middle" className="gauge-num" fill={color}>{score}</text>
        <text x={CX} y={CY + 2} textAnchor="middle" className="gauge-of">/ 100</text>
      </svg>
      <figcaption className="gauge-caption">{t("gauge.caption", { level: levelName })}</figcaption>
      <ul className="gauge-legend" aria-hidden="true">
        {LEVELS.map((l) => (
          <li key={l} className={`risk-${l}`} data-active={l === level}>
            <i />{t(`level.${l}`)} <span className="mono">{RANGES[l]}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
