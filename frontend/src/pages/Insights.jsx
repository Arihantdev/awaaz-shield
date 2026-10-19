import { lazy, Suspense, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpDown, Box, CircleHelp, FlaskConical, Flag, Gauge, PhoneCall, RotateCcw, ShieldAlert, X } from "lucide-react";
import EChart, { COLORS } from "../charts/EChart";
import AnimatedNumber from "../components/AnimatedNumber";
import Spinner from "../components/Spinner";
import RiskBadge from "../components/RiskBadge";
import { signalLabel, useI18n } from "../i18n";
import { prefersReducedMotion, webglAvailable } from "../three/useScene";

const SkylineScene = lazy(() => import("./SkylineScene"));

const LEVELS = ["low", "medium", "high", "critical"];
const short = (s, n = 24) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const THRESH = [30, 55, 80];

/** One plain row per call; everything on the page is computed from these. */
export function buildRows(calls) {
  return calls.map((c) => {
    const signals = c.signals && c.signals.length ? c.signals : (c.alerts || []).flatMap((a) => a.matched_patterns || []);
    const peak = Math.max(0, ...(c.risk_history || []).map((p) => p.score), c.current_score || 0);
    const level = c.current_level;
    return {
      id: c.id, label: c.label, level, score: c.current_score || 0, peak, signals: [...new Set(signals)],
      status: c.status, disposition: c.disposition || null,
      needs: (level === "high" || level === "critical") && !c.disposition,
      history: (c.risk_history || []).map((p) => p.score),
    };
  });
}

export default function Insights({ calls, onOpenCall, onLoadSamples = null, loadingSamples = false }) {
  const { t } = useI18n();
  const [levels, setLevels] = useState(() => new Set());
  const [tactic, setTactic] = useState(null);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [sort, setSort] = useState({ key: "peak", dir: -1 });
  const [resetKey, setResetKey] = useState(0);
  const gl = useMemo(() => webglAvailable(), []);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  const rows = useMemo(() => buildRows(calls), [calls]);
  const fTactic = (r) => !tactic || r.signals.includes(tactic);
  const fNeeds = (r) => !needsOnly || r.needs;
  const fLevel = (r) => levels.size === 0 || levels.has(r.level);
  const shown = useMemo(() => rows.filter((r) => fTactic(r) && fNeeds(r) && fLevel(r)), [rows, tactic, needsOnly, levels]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => rows.filter((r) => fTactic(r) && fNeeds(r)), [rows, tactic, needsOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const dimmed = useMemo(() => new Set(rows.filter((r) => !shown.includes(r)).map((r) => r.id)), [rows, shown]);
  const filtered = tactic || needsOnly || levels.size > 0;

  const kpi = useMemo(() => ({
    total: shown.length,
    risky: shown.filter((r) => r.level === "high" || r.level === "critical").length,
    needs: shown.filter((r) => r.needs).length,
    avg: shown.length ? shown.reduce((a, r) => a + r.peak, 0) / shown.length : 0,
  }), [shown]);

  const tacticCounts = useMemo(() => {
    const m = {};
    for (const r of rows.filter((x) => fNeeds(x) && fLevel(x))) for (const s of r.signals) m[s] = (m[s] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [rows, needsOnly, levels]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLevel = (l) => setLevels((prev) => { const n = new Set(prev); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const clearAll = () => { setLevels(new Set()); setTactic(null); setNeedsOnly(false); };

  // Interactive pie: hover for counts, click a slice to filter the whole page (selected slices pull out).
  const donut = useMemo(() => ({
    tooltip: { trigger: "item", formatter: (p) => `${p.marker} ${p.name}<br/><b>${p.value}</b> ${t("ins.calls")} · ${Math.round(p.percent)}%` },
    legend: { bottom: 0, textStyle: { color: COLORS.text }, icon: "circle", itemWidth: 8, selectedMode: false },
    series: [{
      type: "pie", radius: "66%", center: ["50%", "46%"], avoidLabelOverlap: true, minShowLabelAngle: 3,
      selectedMode: "multiple", selectedOffset: 14, startAngle: 90,
      itemStyle: { borderColor: COLORS.surface, borderWidth: 2 },
      label: { show: true, color: COLORS.text, fontSize: 12, formatter: (p) => (p.value ? `${p.name}\n${p.value} · ${Math.round(p.percent)}%` : "") },
      labelLine: { lineStyle: { color: COLORS.line }, length: 10, length2: 8 },
      emphasis: { scaleSize: 8, itemStyle: { shadowBlur: 18, shadowColor: "rgba(0,0,0,0.55)" }, label: { fontWeight: 600 } },
      data: LEVELS.map((l) => ({
        name: t(`level.${l}`), value: base.filter((r) => r.level === l).length, key: l, selected: levels.has(l),
        itemStyle: { color: COLORS[l], opacity: levels.size === 0 || levels.has(l) ? 1 : 0.3 },
      })),
    }],
  }), [base, levels, t]);

  const tacticsOpt = useMemo(() => {
    const rev = [...tacticCounts].reverse();
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: COLORS.line } }, axisLabel: { color: COLORS.faint } },
      yAxis: { type: "category", data: rev.map(([k]) => short(signalLabel(t, k), 28)), axisLine: { lineStyle: { color: COLORS.line } }, axisLabel: { color: COLORS.text } },
      series: [{
        type: "bar", barMaxWidth: 16, name: t("ins.tacticsName"),
        data: rev.map(([k, v]) => ({ value: v, key: k, itemStyle: { color: COLORS.signal, opacity: !tactic || tactic === k ? 1 : 0.3, borderRadius: [0, 4, 4, 0] } })),
      }],
    };
  }, [tacticCounts, tactic, t]);

  const trajectories = useMemo(() => {
    const recent = shown.filter((r) => r.history.length > 0).slice(0, 6);
    const longest = Math.max(1, ...recent.map((r) => r.history.length));
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 44, containLabel: true },
      tooltip: { trigger: "axis" },
      legend: { type: "scroll", bottom: 0, textStyle: { color: COLORS.text }, icon: "roundRect", itemWidth: 12, itemHeight: 4 },
      xAxis: { type: "category", boundaryGap: false, data: Array.from({ length: longest }, (_, i) => `#${i + 1}`), axisLine: { lineStyle: { color: COLORS.line } }, axisLabel: { color: COLORS.faint } },
      yAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: COLORS.line } }, axisLabel: { color: COLORS.faint } },
      series: recent.map((r, i) => ({
        type: "line", name: short(r.label, 26), showSymbol: r.history.length < 15, symbolSize: 7, smooth: 0.2,
        lineStyle: { width: 2.4, color: COLORS[r.level] }, itemStyle: { color: COLORS[r.level] },
        emphasis: { focus: "series", lineStyle: { width: 3.6 } }, blur: { lineStyle: { opacity: 0.18 } },
        data: r.history,
        ...(i === 0 ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { type: "dashed", color: "#55555c" }, data: THRESH.map((y) => ({ yAxis: y })) } } : {}),
      })),
    };
  }, [shown]);

  const peakFallback = useMemo(() => {
    const rev = [...shown].sort((a, b) => b.peak - a.peak).slice(0, 8).reverse();
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: COLORS.line } }, axisLabel: { color: COLORS.faint } },
      yAxis: { type: "category", data: rev.map((r) => short(r.label)), axisLabel: { color: COLORS.text } },
      series: [{ type: "bar", barMaxWidth: 16, name: t("ins.peakName"), data: rev.map((r) => ({ value: r.peak, itemStyle: { color: COLORS[r.level], borderRadius: [0, 4, 4, 0] } })) }],
    };
  }, [shown, t]);

  const sorted = useMemo(() => {
    const val = { peak: (r) => r.peak, name: (r) => r.label.toLowerCase(), status: (r) => r.status, decision: (r) => r.disposition || "~" };
    const f = val[sort.key];
    return [...shown].sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * sort.dir);
  }, [shown, sort]);
  const setSortKey = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === "name" ? 1 : -1 }));
  const ariaSort = (key) => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none");

  if (rows.length === 0) {
    return (
      <section className="insights">
        <div className="placeholder">
          <div>
            <p>{t("ins.empty")}</p>
            {onLoadSamples && (
              <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={onLoadSamples} disabled={loadingSamples} aria-busy={loadingSamples}>
                {loadingSamples ? <Spinner /> : <FlaskConical size={14} aria-hidden="true" />}{t("demo.samples")}
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  const tip = (r) => `${t("ins.peakName")} ${r.peak} · ${t(`level.${r.level}`)}${r.signals.length ? " · " + r.signals.slice(0, 2).map((s) => signalLabel(t, s)).join(", ") : ""}`;
  const fade = (i) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, delay: i * 0.05 } });

  return (
    <section className="insights" aria-label={t("ins.title")}>
      <header className="insights-head">
        <h2>{t("ins.title")}</h2>
        <p>{t("ins.sub", { n: rows.length })}</p>
      </header>

      <div className="ins-filters" role="group" aria-label={t("ins.filters")}>
        <span className="ins-filters-label">{t("ins.filters")}</span>
        <button className="fchip" aria-pressed={levels.size === 0} onClick={() => setLevels(new Set())}>{t("ins.allLevels")}</button>
        {LEVELS.map((l) => (
          <button key={l} className={`fchip risk-${l}`} aria-pressed={levels.has(l)} onClick={() => toggleLevel(l)}>
            <i aria-hidden="true" />{t(`level.${l}`)}
          </button>
        ))}
        <button className="fchip" aria-pressed={needsOnly} onClick={() => setNeedsOnly((v) => !v)}>{t("ins.needsOnly")}</button>
        {tactic && (
          <button className="fchip active-tactic" onClick={() => setTactic(null)} aria-label={t("ins.clear")}>
            {t("ins.tacticFilter", { name: signalLabel(t, tactic) })} <X size={13} aria-hidden="true" />
          </button>
        )}
        <span className="ins-count" role="status">{t("ins.showing", { shown: shown.length, total: rows.length })}</span>
        {filtered && <button className="linkbtn" onClick={clearAll}>{t("ins.clear")}</button>}
      </div>

      <div className="tiles">
        <Tile icon={PhoneCall} tone="low" value={kpi.total} label={t("ins.kpiCalls")} />
        <Tile icon={ShieldAlert} tone="critical" value={kpi.risky} label={t("ins.kpiRisky")} />
        <Tile icon={Flag} tone="high" value={kpi.needs} label={t("ins.kpiNeeds")} onClick={() => setNeedsOnly((v) => !v)} pressed={needsOnly} />
        <Tile icon={Gauge} tone="medium" value={kpi.avg} decimals={1} label={t("ins.kpiAvg")} />
      </div>

      <div className="ins-grid">
        <motion.div className="card sky-card" {...fade(0)}>
          <h3>
            <Box size={15} aria-hidden="true" /> {t("ins.sky")}
            {gl && <button className="btn btn-sm sky-reset" onClick={() => setResetKey((k) => k + 1)}><RotateCcw size={13} aria-hidden="true" /> {t("ins.skyReset")}</button>}
          </h3>
          {gl ? (
            <>
              <div className="sky-stage" role="img" aria-label={t("ins.skyAria")}>
                <Suspense fallback={<div className="center-load">{t("common.loading")}</div>}>
                  <SkylineScene rows={rows} dimmed={dimmed} onPick={onOpenCall} resetKey={resetKey} reduced={reduced} tip={tip} />
                </Suspense>
              </div>
              <p className="sky-help"><CircleHelp size={13} aria-hidden="true" /> {t("ins.skyHelp")}</p>
              <div className="sky-legend" aria-hidden="true">
                {LEVELS.map((l) => (<span key={l}><i style={{ background: COLORS[l] }} />{t(`level.${l}`)}</span>))}
                <span className="sky-dot"><i className="ring" />{t("ins.skyNeeds")}</span>
              </div>
            </>
          ) : (
            <>
              <p className="empty-note" style={{ padding: 0 }}>{t("ins.noGl")}</p>
              <EChart option={peakFallback} height={Math.max(200, shown.length * 34 + 24)} label={t("ins.peakAria")} />
            </>
          )}
        </motion.div>

        <motion.div className="card" {...fade(1)}>
          <h3>{t("ins.mix")} <span className="badge-muted">{t("ins.clickHint")}</span></h3>
          <EChart option={donut} height={300} label={t("ins.mixAria")} onClick={(p) => p.data?.key && toggleLevel(p.data.key)} />
        </motion.div>

        <motion.div className="card wide" {...fade(2)}>
          <h3>{t("ins.traj")} <span className="badge-muted">{t("ins.trajBadge", { n: Math.min(6, shown.filter((r) => r.history.length).length) })}</span></h3>
          <EChart option={trajectories} height={270} label={t("ins.trajAria")} />
        </motion.div>

        <motion.div className="card" {...fade(3)}>
          <h3>{t("ins.tactics")} <span className="badge-muted">{t("ins.clickHint")}</span></h3>
          {tacticCounts.length === 0 ? (
            <p className="empty-note" style={{ padding: 0 }}>{t("ins.tacticsNone")}</p>
          ) : (
            <EChart option={tacticsOpt} height={Math.max(180, tacticCounts.length * 34 + 24)} label={t("ins.tacticsAria")} onClick={(p) => { const k = p.data?.key; if (k) setTactic((cur) => (cur === k ? null : k)); }} />
          )}
        </motion.div>

        <motion.div className="card" {...fade(4)}>
          <h3>{t("ins.review")}</h3>
          {rows.filter((r) => r.needs).length === 0 ? (
            <p className="empty-note" style={{ padding: 0 }}>{t("ins.reviewNone")}</p>
          ) : (
            <ul className="review-list">
              {rows.filter((r) => r.needs).slice(0, 6).map((r) => (
                <li key={r.id}>
                  <button className="review-item" onClick={() => onOpenCall(r.id)}>
                    <span className="review-name">{r.label}</span>
                    <RiskBadge score={r.score} level={r.level} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </motion.div>

        <motion.div className="card wide" {...fade(5)}>
          <h3>{t("ins.table")}</h3>
          {sorted.length === 0 ? (
            <p className="empty-note" style={{ padding: 0 }}>{t("ins.none")}</p>
          ) : (
            <div className="table-wrap">
              <table className="ins-table">
                <thead>
                  <tr>
                    <th aria-sort={ariaSort("name")}><button onClick={() => setSortKey("name")}>{t("ins.colCall")} <ArrowUpDown size={12} aria-hidden="true" /></button></th>
                    <th aria-sort={ariaSort("peak")}><button onClick={() => setSortKey("peak")}>{t("ins.colScore")} <ArrowUpDown size={12} aria-hidden="true" /></button></th>
                    <th>{t("ins.colTactics")}</th>
                    <th aria-sort={ariaSort("status")}><button onClick={() => setSortKey("status")}>{t("ins.colStatus")} <ArrowUpDown size={12} aria-hidden="true" /></button></th>
                    <th aria-sort={ariaSort("decision")}><button onClick={() => setSortKey("decision")}>{t("ins.colDecision")} <ArrowUpDown size={12} aria-hidden="true" /></button></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id}>
                      <td><button className="row-open" onClick={() => onOpenCall(r.id)}>{r.label}</button></td>
                      <td><RiskBadge score={r.peak} level={r.level} /></td>
                      <td className="tcell">{r.signals.length === 0 ? "-" : r.signals.slice(0, 3).map((s) => (
                        <button key={s} className={`sig-chip ${tactic === s ? "on" : ""}`} onClick={() => setTactic((cur) => (cur === s ? null : s))}>{signalLabel(t, s)}</button>
                      ))}</td>
                      <td>{r.status === "active" ? t("status.inProgress") : t("status.ended")}</td>
                      <td>{r.disposition ? <span className={`badge-muted disp disp-${r.disposition}`}>{t(`disp.${r.disposition}`)}</span> : (r.needs ? <span className="badge-muted waiting">{t("ins.waiting")}</span> : "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}

function Tile({ icon: Icon, tone, value, decimals = 0, label, onClick, pressed }) {
  const inner = (
    <>
      <Icon size={18} aria-hidden="true" />
      <b className="mono"><AnimatedNumber value={value} decimals={decimals} /></b>
      <span>{label}</span>
    </>
  );
  return onClick ? (
    <button className={`tile tile-btn risk-${tone}`} aria-pressed={pressed} onClick={onClick}>{inner}</button>
  ) : (
    <div className={`tile risk-${tone}`}>{inner}</div>
  );
}
