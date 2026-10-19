import { Database, Gauge, KeyRound, Mic, Radio, RefreshCw } from "lucide-react";
import { friendlyError } from "../lib/errors";
import { useT } from "../i18n";
import { speechSupported } from "./MicCapture";

/**
 * What is really running, taken from /api/status and the live socket. Nothing here is assumed:
 * if the status cannot be loaded the panel says so instead of showing optimistic defaults.
 */
export default function SystemStatus({ status, error, wsStatus, onRetry }) {
  const t = useT();
  const ws = wsStatus === "connected";

  const rows = [
    { id: "ws", icon: Radio, label: t("sys.ws"), value: ws ? t("sys.wsOn") : t("sys.wsOff"), tone: ws ? "ok" : "warn" },
  ];
  if (status) {
    rows.push(
      { id: "scoring", icon: Gauge, label: t("sys.scoring"), value: status.scoring_backend === "claude" ? t("sys.scoringClaude") : t("sys.scoringRules"), tone: "ok" },
      { id: "auth", icon: KeyRound, label: t("sys.auth"), value: status.firebase_auth ? t("sys.authFirebase") : t("sys.authDev"), tone: status.firebase_auth ? "ok" : "warn" },
      { id: "saved", icon: Database, label: t("sys.saved"), value: status.firestore_persistence ? t("sys.savedOn") : t("sys.savedOff"), tone: status.firestore_persistence ? "ok" : "off" },
    );
  }
  rows.push({ id: "mic", icon: Mic, label: t("sys.mic"), value: speechSupported ? t("sys.micOn") : t("sys.micOff"), tone: speechSupported ? "ok" : "warn" });

  return (
    <section className="block status-block" aria-labelledby="sys-title">
      <h3 id="sys-title">{t("sys.title")}</h3>
      <ul className="status-list">
        {rows.map(({ id, icon: Icon, label, value, tone }) => (
          <li key={id}>
            <Icon size={15} aria-hidden="true" />
            <span className="status-label">{label}</span>
            <span className={`status-value tone-${tone}`}><i aria-hidden="true" />{value}</span>
          </li>
        ))}
        {!status && !error && [0, 1, 2].map((i) => <li key={`sk${i}`} className="skeleton skeleton-row" aria-hidden="true" />)}
      </ul>
      {error && !status && (
        <div className="inline-error" role="alert">
          <p>{t("sys.error")} {friendlyError(t, error)}</p>
          <button type="button" className="btn btn-sm" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />{t("sys.retry")}</button>
        </div>
      )}
    </section>
  );
}
