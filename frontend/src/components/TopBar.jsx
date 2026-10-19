import { Command, LogOut } from "lucide-react";
import AnimatedNumber from "./AnimatedNumber";
import LanguageSelect from "./LanguageSelect";
import { useT } from "../i18n";
import { useAuth } from "../context/AuthContext";

export default function TopBar({ analytics, wsStatus, onPalette }) {
  const { identity, logout } = useAuth();
  const t = useT();
  const live = wsStatus === "connected";

  return (
    <header className="topbar">
      <div className="brand">
        <Mark />
        <h1>Awaaz Shield</h1>
        <span className={`live ${live ? "" : "off"}`} role="status" title={live ? t("top.liveTitle") : t("top.reconnectTitle")}>
          <i /> {live ? t("top.live") : t("top.reconnecting")}
        </span>
      </div>

      {analytics && (
        <div className="kpis" aria-label={t("top.summary")}>
          <Kpi label={t("top.monitored")} value={analytics.monitored_calls} />
          <Kpi label={t("top.active")} value={analytics.active_calls} />
          <Kpi label={t("top.alerts")} value={analytics.high_risk_alerts} alert />
          <Kpi label={t("top.avg")} value={analytics.average_risk_score} decimals={1} />
        </div>
      )}

      <div className="userbox">
        <LanguageSelect />
        <button className="btn btn-ghost btn-sm kbd-btn" onClick={onPalette} aria-label={t("top.palette")}>
          <Command size={13} aria-hidden="true" /> K
        </button>
        {identity && (
          <span className="email" title={identity.email}>
            {identity.email}
            {identity.dev_mode && <span className="badge-muted" style={{ marginLeft: 6 }}>{t("top.devMode")}</span>}
            {identity.operator && <span className="badge-muted" style={{ marginLeft: 6 }}>{t("top.operator")}</span>}
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} aria-hidden="true" />{t("top.logout")}</button>
      </div>
    </header>
  );
}

function Kpi({ label, value, alert, decimals = 0 }) {
  return (
    <div className={`kpi ${alert && value > 0 ? "alert" : ""}`}>
      <b><AnimatedNumber value={value} decimals={decimals} /></b>
      <span>{label}</span>
    </div>
  );
}

export function Mark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <circle cx="17" cy="17" r="15.5" stroke="var(--signal)" strokeWidth="1.4" opacity="0.45" />
      <path d="M9 17c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="var(--signal)" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="14.5" y="13" width="5" height="9" rx="2.5" fill="var(--signal)" />
      <path d="M17 22v3" stroke="var(--signal)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
