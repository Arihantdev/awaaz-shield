// Shapes real call data for the 3D risk landscape: one ridge per call (newest at the front),
// left to right is the call's own timeline, height is the risk score. Pure data, no scoring.

export const RIDGES = 12;
export const COLS = 64;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ms = (iso) => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

export function resampleSeries(values, n = COLS) {
  const out = new Float32Array(n);
  const len = values.length;
  if (len === 0) return out;
  if (len === 1) {
    out.fill(values[0]);
    return out;
  }
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (len - 1);
    const a = Math.floor(x);
    const b = Math.min(len - 1, a + 1);
    out[i] = values[a] + (values[b] - values[a]) * (x - a);
  }
  return out;
}

export function buildLandscape(calls, selectedId = null) {
  const shown = [...(calls || [])].sort((a, b) => ms(a.started_at) - ms(b.started_at)).slice(-RIDGES);
  const heights = new Float32Array(RIDGES * COLS);
  const levels = Array(RIDGES).fill(null);
  const ids = Array(RIDGES).fill(null);
  const offset = RIDGES - shown.length; // empty rows sit at the back
  shown.forEach((c, i) => {
    const row = offset + i;
    const series = (c.risk_history || []).map((p) => clamp01(p.score / 100));
    if (!series.length) series.push(clamp01((c.current_score || 0) / 100));
    heights.set(resampleSeries(series), row * COLS);
    levels[row] = c.current_level || "low";
    ids[row] = c.id;
  });
  return { heights, levels, selectedRow: selectedId ? ids.indexOf(selectedId) : -1, count: shown.length };
}
