import { AnimatePresence, motion } from "motion/react";
import RiskBadge from "./RiskBadge";
import { useT } from "../i18n";

const open = (c) => c.disposition !== "dismissed";
export const FILTERS = [
  { id: "all", key: "list.all", test: open },
  { id: "active", key: "list.active", test: (c) => open(c) && c.status === "active" },
  { id: "risky", key: "list.risky", test: (c) => open(c) && (c.current_level === "high" || c.current_level === "critical") },
  { id: "flagged", key: "list.flagged", test: (c) => c.disposition === "flagged", count: true },
  { id: "history", key: "list.history", test: (c) => c.disposition === "dismissed", count: true },
];

// escalated calls first; everything else keeps the order it arrived in
const byPriority = (a, b) => (b.disposition === "escalated") - (a.disposition === "escalated");

export default function CallList({ calls, selectedId, onSelect, filter, onFilter, loading = false }) {
  const t = useT();
  const test = FILTERS.find((f) => f.id === filter).test;
  const shown = calls.filter(test).sort(byPriority);

  return (
    <>
      <div className="chips" role="group" aria-label={t("list.filter")}>
        {FILTERS.map((f) => (
          <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {t(f.key)}
            {f.count && calls.some(f.test) && <span className="chip-count">{calls.filter(f.test).length}</span>}
          </button>
        ))}
      </div>
      <div className="call-scroll">
        {loading && [0, 1, 2].map((i) => <div key={i} className="skeleton skeleton-call" aria-hidden="true" />)}
        {!loading && calls.length === 0 && <div className="empty-note">{t("list.empty")}</div>}
        {!loading && calls.length > 0 && shown.length === 0 && <div className="empty-note">{t("list.noMatch")}</div>}
        <AnimatePresence initial={false}>
        {shown.map((call) => (
          <motion.div
            key={call.id}
            layout="position"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
          <button
            className={`call-item risk-${call.current_level}${call.disposition === "escalated" ? " is-escalated" : ""}`}
            aria-current={call.id === selectedId}
            onClick={() => onSelect(call.id)}
          >
            <div className="row">
              <span className="name">{call.label}</span>
              {call.status === "active" ? (
                <span className="live-ring" title={t("list.inProgress")} />
              ) : (
                <span className="badge-muted">{t("list.ended")}</span>
              )}
            </div>
            <div className="row meta">
              <RiskBadge score={call.current_score} level={call.current_level} />
              <span className="row" style={{ gap: 8 }}>
                {call.ended_reason === "auto_risk" && <span className="badge-muted disp disp-escalated">{t("list.autoEnded")}</span>}
                {call.disposition && <span className={`badge-muted disp disp-${call.disposition}`}>{t(`disp.${call.disposition}`)}</span>}
                <span className="mono id">{call.id.slice(0, 8)}</span>
              </span>
            </div>
          </button>
          </motion.div>
        ))}
        </AnimatePresence>
      </div>
    </>
  );
}
