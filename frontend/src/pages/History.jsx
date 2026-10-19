import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import PageShell from "../components/PageShell";
import RiskBadge from "../components/RiskBadge";
import Spinner from "../components/Spinner";

const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
function duration(call) {
  if (!call.ended_at) return null;
  const s = Math.max(0, Math.round((new Date(call.ended_at) - new Date(call.started_at)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** Past sessions with their final score and, if the person opens one, the saved transcript lines. */
export default function History() {
  const t = useT();
  const [calls, setCalls] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    api.listCalls().then((c) => live && setCalls(c)).catch((e) => live && setErr(e?.message || t("ev.errNetwork")));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell title={t("hist.title")}>
      <p className="muted pg-lead">{t("hist.lead")}</p>
      {err && <p className="msg-error" role="alert">{err}</p>}
      {!calls && !err && <p className="muted"><Spinner /> {t("hist.loading")}</p>}
      {calls && calls.length === 0 && <p className="muted">{t("hist.empty")}</p>}
      <ul className="hist-list">
        {(calls || []).map((c) => (
          <li key={c.id} className="vc-card hist-item">
            <details>
              <summary>
                <span className="hist-main">
                  <b>{c.label}</b>
                  <span className="muted">{fmtDate(c.started_at)} · {duration(c) ?? t("hist.ongoing")} · {t("hist.lines", { n: c.transcript.length })}</span>
                </span>
                <RiskBadge score={c.current_score} level={c.current_level} />
              </summary>
              {c.last_explanation && <p className="hist-expl">{c.last_explanation}</p>}
              {c.transcript.length === 0
                ? <p className="muted">{t("hist.noTranscript")}</p>
                : (
                  <ol className="hist-lines">
                    {c.transcript.map((l) => <li key={l.id}><b>{l.speaker === "agent" ? t("voice.them") : t("hist.caller")}</b> {l.text}</li>)}
                  </ol>
                )}
            </details>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
