// Flattens real call data (start/end, transcript, alerts, operator actions) into one time-ordered list
// for the JSON event stream. Nothing is invented: an empty dashboard yields an empty list.

const ms = (iso) => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

export function buildEventLog(calls, limit = 120) {
  const out = [];
  for (const c of calls || []) {
    const call = c.label;
    if (c.started_at) out.push({ key: `${c.id}:start`, ts: c.started_at, level: "info", type: "call_started", call, source: c.source });
    for (const ch of c.transcript || []) {
      out.push({ key: `t:${ch.id}`, ts: ch.ts, level: "info", type: "transcript", call, speaker: ch.speaker, text: ch.text });
    }
    for (const a of c.alerts || []) {
      out.push({
        key: `a:${a.id}`, ts: a.ts, level: a.level === "critical" ? "critical" : "warn",
        type: "alert", call, risk: a.level, signals: a.signals || [], message: a.message,
      });
    }
    for (const a of c.actions || []) {
      out.push({ key: `x:${a.id}`, ts: a.ts, level: "info", type: "operator_action", call, action: a.type, ...(a.note ? { note: a.note } : {}) });
    }
    if (c.ended_at) out.push({ key: `${c.id}:end`, ts: c.ended_at, level: "info", type: "call_ended", call, final_score: c.current_score });
  }
  out.sort((x, y) => ms(x.ts) - ms(y.ts) || (x.key < y.key ? -1 : 1));
  return out.slice(-limit);
}
