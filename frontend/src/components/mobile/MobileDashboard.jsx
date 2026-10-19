import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, FlaskConical, LogIn, Play, PhoneCall, ShieldCheck } from "lucide-react";
import { Toaster } from "sonner";
import { useT } from "../../i18n";
import RiskBadge from "../RiskBadge";
import CallList from "../CallList";
import CallDetailPanel from "../CallDetailPanel";
import InstallHelp from "../InstallHelp";
import Spinner from "../Spinner";
import { isHighRisk } from "../../lib/risk";

const normaliseCode = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Phone version of the dashboard: Home (what needs attention, quick actions) and Calls (list, then one call full screen). */
export default function MobileDashboard({
  calls, loaded, analytics, wsStatus, onSelect, onChanged, deepgramAvailable, onStartDemo, onLoadSamples, loadingSamples, filter, onFilter,
}) {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tab = params.get("v") === "calls" ? "calls" : "home";
  const detailId = params.get("c");
  const detail = detailId ? calls.find((c) => c.id === detailId) : null;
  const [code, setCode] = useState("");

  // keep the shared "selected call" in step with the one on screen, so action buttons refresh the right call
  useEffect(() => { if (detail) onSelect(detail.id); }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCall = (id) => navigate(`/dashboard?v=calls&c=${id}`);
  const open = calls.filter((c) => c.disposition !== "dismissed");
  const attention = open
    .filter((c) => isHighRisk(c.current_level) && !c.disposition)
    .sort((a, b) => b.current_score - a.current_score)[0];
  const recent = open.slice(0, 4);
  const live = wsStatus === "connected";

  if (tab === "calls" && detail) {
    return (
      <div className="m-detail">
        <button className="m-back" onClick={() => navigate("/dashboard?v=calls")}><ChevronLeft size={20} aria-hidden="true" />{t("m.back")}</button>
        <CallDetailPanel call={detail} onChanged={onChanged} deepgramAvailable={deepgramAvailable} />
        <Toaster position="bottom-center" theme="dark" visibleToasts={2} closeButton />
      </div>
    );
  }

  if (tab === "calls") {
    return (
      <div className="m-stack">
        <h1 className="m-title">{t("m.tab.calls")}</h1>
        <CallList calls={calls} selectedId={null} onSelect={openCall} filter={filter} onFilter={onFilter} loading={!loaded} />
        <Toaster position="bottom-center" theme="dark" visibleToasts={2} closeButton />
      </div>
    );
  }

  return (
    <div className="m-stack">
      <div className="m-status">
        <h1 className="m-title">{t("m.tab.home")}</h1>
        <span className={`live ${live ? "" : "off"}`} role="status"><i /> {live ? t("top.live") : t("top.reconnecting")}</span>
      </div>

      {attention ? (
        <button className={`m-card m-attn risk-${attention.current_level}`} onClick={() => openCall(attention.id)}>
          <span className="m-eyebrow">{t("m.attn")}</span>
          <span className="m-attn-row">
            <span className="m-score" style={{ color: `var(--risk-${attention.current_level})` }}>{attention.current_score}</span>
            <span className="m-attn-text">
              <b>{attention.label}</b>
              <RiskBadge score={attention.current_score} level={attention.current_level} />
            </span>
            <ChevronRight size={20} aria-hidden="true" />
          </span>
          {attention.last_explanation && <span className="m-expl">{attention.last_explanation}</span>}
        </button>
      ) : (
        <div className="m-card m-clear">
          <ShieldCheck size={26} aria-hidden="true" />
          <div><b>{t("m.clear")}</b><span className="muted">{t("m.clearDesc")}</span></div>
        </div>
      )}

      {analytics && (
        <div className="m-stats" aria-label={t("top.summary")}>
          <div className="m-stat"><b>{analytics.monitored_calls}</b><span>{t("m.stat.monitored")}</span></div>
          <div className="m-stat"><b>{analytics.active_calls}</b><span>{t("m.stat.active")}</span></div>
          <div className={`m-stat ${analytics.high_risk_alerts > 0 ? "alert" : ""}`}><b>{analytics.high_risk_alerts}</b><span>{t("m.stat.alerts")}</span></div>
        </div>
      )}

      <section className="m-card m-stack-sm">
        <button className="btn btn-primary m-big" onClick={() => navigate("/call")}>
          <PhoneCall size={18} aria-hidden="true" />{t("m.start")}
        </button>
        <p className="muted">{t("m.startDesc")}</p>
        <form className="m-join" onSubmit={(e) => { e.preventDefault(); if (code.length >= 6) navigate(`/call?join=${code}`); }}>
          <input
            value={code}
            onChange={(e) => setCode(normaliseCode(e.target.value).slice(0, 6))}
            placeholder="ABC123"
            aria-label={t("voice.codeLabel")}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn m-join-btn" disabled={code.length < 6}><LogIn size={16} aria-hidden="true" />{t("m.joinBtn")}</button>
        </form>
      </section>

      <section className="m-stack-sm">
        <div className="m-section-head"><h2>{t("m.recent")}</h2>{open.length > 0 && <button className="m-link" onClick={() => navigate("/dashboard?v=calls")}>{t("m.seeAll")}</button>}</div>
        {recent.map((c) => (
          <button key={c.id} className={`m-row risk-${c.current_level}`} onClick={() => openCall(c.id)}>
            <span className="m-row-main"><b>{c.label}</b><span className="muted">{c.status === "active" ? t("list.inProgress") : t("list.ended")}</span></span>
            <RiskBadge score={c.current_score} level={c.current_level} />
          </button>
        ))}
        {loaded && open.length === 0 && (
          <div className="m-card m-empty">
            <p className="muted">{t("m.noCalls")}</p>
            <button className="btn m-big" onClick={onLoadSamples} disabled={loadingSamples} aria-busy={loadingSamples}>
              {loadingSamples ? <Spinner /> : <FlaskConical size={16} aria-hidden="true" />}{t("m.loadSamples")}
            </button>
            <button className="btn m-big" onClick={() => onStartDemo(t("demo.defaultName"))}><Play size={16} aria-hidden="true" />{t("m.demo")}</button>
          </div>
        )}
      </section>

      <InstallHelp />
      <Toaster position="bottom-center" theme="dark" visibleToasts={2} closeButton />
    </div>
  );
}
