import { motion } from "motion/react";
import RiskGauge from "../RiskGauge";
import AnimatedNumber from "../AnimatedNumber";
import { LEVEL_HEX, isHighRisk } from "../../lib/risk";
import { signalLabel, useT } from "../../i18n";

function Card({ title, hint, index, danger, children }) {
  return (
    <motion.article
      className={`cc-card${danger ? " cc-danger" : ""}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut", delay: index * 0.06 }}
      whileHover={{ y: -3 }}
      data-cursor
    >
      <span className="cc-flash" aria-hidden="true" />
      <header className="cc-card-head">
        <h3>{title}</h3>
        {hint && <span className="mono">{hint}</span>}
      </header>
      {children}
    </motion.article>
  );
}

function Sparkline({ values, color }) {
  const w = 200, h = 56, pad = 4;
  if (values.length < 2) return <div className="cc-spark-empty" aria-hidden="true" />;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - pad - (Math.min(100, Math.max(0, v)) / 100) * (h - pad * 2)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="cc-spark" preserveAspectRatio="none" aria-hidden="true">
      {[25, 50, 75].map((g) => (
        <line key={g} x1="0" x2={w} y1={h - pad - (g / 100) * (h - pad * 2)} y2={h - pad - (g / 100) * (h - pad * 2)} className="cc-spark-grid" />
      ))}
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} opacity="0.14" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3" fill={color} />
    </svg>
  );
}

export default function CommandCards({ call, calls }) {
  const t = useT();
  const score = call?.current_score ?? 0;
  const level = call?.current_level ?? "low";
  const history = (call?.risk_history || []).slice(-60).map((p) => p.score);
  const peak = history.length ? Math.max(...history) : 0;
  const signals = call?.signals || [];
  const active = calls.filter((c) => c.status === "active" && c.disposition !== "dismissed");
  const elevated = active.filter((c) => isHighRisk(c.current_level)).length;

  return (
    <section className="cc-cards" aria-label={t("cc.cardsLabel")}>
      <Card title={t("cc.prob")} index={0} danger={isHighRisk(level)}>
        <div className="cc-gauge"><RiskGauge score={score} level={level} /></div>
      </Card>

      <Card title={t("cc.trend")} hint={history.length ? t("cc.trendPts", { n: history.length }) : null} index={1}>
        <p className="cc-big mono"><AnimatedNumber value={peak} /><small>{t("cc.trendPeak")}</small></p>
        <Sparkline values={history} color={LEVEL_HEX[level]} />
      </Card>

      <Card title={t("cc.signals")} index={2}>
        <p className="cc-big mono"><AnimatedNumber value={signals.length} /></p>
        <div className="cc-chips">
          {signals.length === 0 && <span className="cc-muted">{t("cc.signalsNone")}</span>}
          {signals.slice(0, 5).map((s) => <span key={s} className="cc-chip">{signalLabel(t, s)}</span>)}
          {signals.length > 5 && <span className="cc-chip cc-chip-more mono">+{signals.length - 5}</span>}
        </div>
      </Card>

      <Card title={t("cc.active")} index={3}>
        <p className="cc-big mono">
          <AnimatedNumber value={active.length} />
          <span className={`cc-state ${elevated ? "cc-state-bad" : "cc-state-ok"}`}>{elevated ? t("cc.elevated", { n: elevated }) : t("cc.allLow")}</span>
        </p>
        <div className="cc-bars" aria-hidden="true">
          {active.slice(0, 8).map((c) => (
            <motion.span key={c.id} layout animate={{ height: `${Math.max(8, c.current_score)}%` }} style={{ background: LEVEL_HEX[c.current_level] }} />
          ))}
        </div>
        <p className="cc-muted mono">{t("cc.perCall")}</p>
      </Card>
    </section>
  );
}
