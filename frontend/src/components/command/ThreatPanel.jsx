import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Eye, Flag, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { api } from "../../api";
import { LEVEL_HEX, isHighRisk } from "../../lib/risk";
import { signalLabel, useI18n } from "../../i18n";

/** Threat status for the followed call. Actions use the same operator endpoints as the call detail screen. */
export default function ThreatPanel({ call, calls, onChanged, onOpenCall, onError }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(null);
  const alert = call?.alerts?.length ? call.alerts[call.alerts.length - 1] : null;
  const threat = !!call && !!alert && isHighRisk(call.current_level);
  const open = calls.filter((c) => c.disposition !== "dismissed");
  const rows = [
    [t("cc.monitored"), open.length],
    [t("cc.activeNow"), open.filter((c) => c.status === "active").length],
    [t("cc.needsReview"), open.filter((c) => isHighRisk(c.current_level) && !c.disposition).length],
  ];

  async function act(type) {
    if (busy) return;
    setBusy(type);
    try {
      await api.recordAction(call.id, type, "");
      onChanged(call.id);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  const message = !alert ? "" : lang === "en" || !alert.signals
    ? alert.message
    : alert.signals.length
      ? t("call.alertMsg", { level: t(`level.${alert.level}`), list: alert.signals.map((s) => signalLabel(t, s)).join(", ") })
      : t("call.alertMsgNone", { level: t(`level.${alert.level}`) });

  return (
    <section className={`cc-panel cc-threat${threat ? " cc-danger" : ""}`} role={threat ? "alert" : "status"} aria-label={t("cc.threat")}>
      <h3 className="cc-panel-title">{t("cc.threat")}</h3>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={threat ? `a${alert.id}` : "clear"}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="cc-threat-body"
        >
          {threat ? (
            <div className="cc-threat-inner">
              <div className="cc-threat-head" data-fx>
                <span className="cc-icon bad"><TriangleAlert size={22} aria-hidden="true" /></span>
                <div>
                  <h4>{t("cc.threatTitle")}</h4>
                  <p className="mono">{call.label}</p>
                </div>
              </div>
              <div className="cc-threat-score" data-fx>
                <span className="cc-label">{t("cc.score")}</span>
                <b className="mono" style={{ color: LEVEL_HEX[call.current_level] }}>{call.current_score}</b>
                <span className={`risk-pill risk-${call.current_level}`}><span className="risk-dot" />{t(`level.${call.current_level}`)}</span>
              </div>
              {message && <p className="cc-threat-msg" data-fx>{message}</p>}
              {call.signals?.length > 0 && (
                <div data-fx>
                  <span className="cc-label">{t("cc.signalsMatched")}</span>
                  <div className="cc-chips">{call.signals.map((s) => <span key={s} className="cc-chip bad">{signalLabel(t, s)}</span>)}</div>
                </div>
              )}
              <div className="cc-actions" data-fx>
                <button className="btn btn-sm btn-danger" disabled={!!busy || !!call.disposition} aria-busy={busy === "escalated"} onClick={() => act("escalated")}><ShieldAlert size={14} aria-hidden="true" />{t("call.escalate")}</button>
                <button className="btn btn-sm" disabled={!!busy || !!call.disposition} aria-busy={busy === "flagged"} onClick={() => act("flagged")}><Flag size={14} aria-hidden="true" />{t("call.flag")}</button>
                <button className="btn btn-sm" disabled={!!busy || !!call.disposition} aria-busy={busy === "dismissed"} onClick={() => act("dismissed")}><Ban size={14} aria-hidden="true" />{t("call.dismiss")}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => onOpenCall(call.id)}><Eye size={14} aria-hidden="true" />{t("cc.openCall")}</button>
              </div>
              {call.disposition && <p className="cc-muted">{t(`disp.${call.disposition}`)}</p>}
            </div>
          ) : (
            <div className="cc-threat-inner">
              <div className="cc-threat-head">
                <span className="cc-icon ok"><ShieldCheck size={22} aria-hidden="true" /></span>
                <div>
                  <h4>{t("cc.clearTitle")}</h4>
                  <p>{t("cc.clearSub")}</p>
                </div>
              </div>
              <dl className="cc-rows">
                {rows.map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>
                ))}
              </dl>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
