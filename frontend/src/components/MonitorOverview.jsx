import { useState } from "react";
import { motion } from "motion/react";
import { FlaskConical, Keyboard, Play, Radio, Gauge } from "lucide-react";
import ShieldCore from "../three/LazyShieldCore";
import SystemStatus from "./SystemStatus";
import ActivityFeed from "./ActivityFeed";
import Spinner from "./Spinner";
import { useT } from "../i18n";

/** Shown on the Live monitor when no call is selected: explains the product, offers the one main action, shows system state. */
export default function MonitorOverview({ calls, server, wsStatus, onStart, onOpenCall, onLoadSamples, loadingSamples = false }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      await onStart();
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { icon: Play, h: t("hero.s1.h"), b: t("hero.s1.b") },
    { icon: Keyboard, h: t("hero.s2.h"), b: t("hero.s2.b") },
    { icon: Gauge, h: t("hero.s3.h"), b: t("hero.s3.b") },
  ];

  return (
    <>
      <main className="stage">
        <motion.section
          className="hero"
          aria-labelledby="hero-title"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <div className="hero-copy">
            <p className="eyebrow"><Radio size={13} aria-hidden="true" />{t("hero.eyebrow")}</p>
            <h2 id="hero-title">{t("hero.title")}</h2>
            <p className="hero-lead">{t("hero.lead")}</p>
            <div className="hero-cta">
              <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy} aria-busy={busy}>
                {busy ? <Spinner size={16} /> : <Play size={16} aria-hidden="true" />}
                {t("hero.start")}
              </button>
              <button type="button" className="btn btn-lg" onClick={onLoadSamples} disabled={loadingSamples} aria-busy={loadingSamples}>
                {loadingSamples ? <Spinner size={16} /> : <FlaskConical size={16} aria-hidden="true" />}
                {t("demo.samples")}
              </button>
              {calls.length > 0 && <span className="hint">{t("hero.pick")}</span>}
            </div>
            <p className="mode-note"><FlaskConical size={14} aria-hidden="true" />{t("hero.demoNote")}</p>
          </div>
          <div className="hero-3d"><ShieldCore /></div>
        </motion.section>

        <ol className="steps" aria-label={t("hero.stepsLabel")}>
          {steps.map(({ icon: Icon, h, b }, i) => (
            <motion.li
              key={h}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.08 + i * 0.06, ease: "easeOut" }}
            >
              <span className="step-icon"><Icon size={16} aria-hidden="true" /></span>
              <div><b>{i + 1}. {h}</b><span>{b}</span></div>
            </motion.li>
          ))}
        </ol>
      </main>

      <aside className="side">
        <SystemStatus status={server.status} error={server.error} wsStatus={wsStatus} onRetry={server.reload} />
        <section className="block" aria-labelledby="act-title">
          <h3 id="act-title">{t("act.title")}</h3>
          <ActivityFeed calls={calls} onOpen={onOpenCall} />
        </section>
      </aside>
    </>
  );
}
