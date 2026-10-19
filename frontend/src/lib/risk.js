// Pure helpers shared by the dashboard UI. They only reshape data the backend already sent;
// nothing here scores a call (scoring stays in backend/app/risk).

/** Same cut-offs as backend/app/models.py `level_for_score`. */
export const THRESHOLDS = { medium: 30, high: 55, critical: 80 };
export const LEVELS = ["low", "medium", "high", "critical"];

/** Level colours; keep in sync with --risk-* in styles.css (needed as raw values for SVG/WebGL). */
export const LEVEL_HEX = { low: "#5fb98a", medium: "#d9b04c", high: "#f0913f", critical: "#f0606a" };

export function levelForScore(score) {
  if (score >= THRESHOLDS.critical) return "critical";
  if (score >= THRESHOLDS.high) return "high";
  if (score >= THRESHOLDS.medium) return "medium";
  return "low";
}

export const isHighRisk = (level) => level === "high" || level === "critical";

const ms = (iso) => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Recent activity across all calls, newest first. Built only from real call data
 * (call start/end, alerts, operator actions); an empty dashboard yields an empty list.
 */
export function deriveActivity(calls, limit = 8) {
  const items = [];
  for (const call of calls || []) {
    const base = { callId: call.id, callLabel: call.label };
    if (call.started_at) items.push({ ...base, id: `${call.id}:start`, kind: "started", ts: call.started_at });
    if (call.ended_at) items.push({ ...base, id: `${call.id}:end`, kind: "ended", ts: call.ended_at });
    for (const a of call.alerts || []) {
      items.push({ ...base, id: `alert:${a.id}`, kind: "alert", ts: a.ts, level: a.level, signals: a.signals || [] });
    }
    for (const a of call.actions || []) {
      items.push({ ...base, id: `action:${a.id}`, kind: "action", ts: a.ts, actionType: a.type, note: a.note || "" });
    }
  }
  items.sort((x, y) => ms(y.ts) - ms(x.ts));
  return items.slice(0, limit);
}
