import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "sonner";
import { Trash2 } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useT } from "../i18n";
import { friendlyError } from "../lib/errors";
import PageShell from "../components/PageShell";
import RiskBadge from "../components/RiskBadge";
import ConfirmDialog from "../components/ConfirmDialog";
import Spinner from "../components/Spinner";

const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
function duration(call) {
  if (!call.ended_at) return null;
  const s = Math.max(0, Math.round((new Date(call.ended_at) - new Date(call.started_at)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** Past sessions with their final score and, if the person opens one, the saved transcript lines. Their own ended sessions can be deleted. */
export default function History() {
  const t = useT();
  const { identity } = useAuth();
  const [calls, setCalls] = useState(null);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(null); // call to delete, or "all"
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.listCalls().then((c) => live && setCalls(c)).catch((e) => live && setErr(e?.message || t("ev.errNetwork")));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = (c) => c.status === "ended" && (!c.owner_uid || c.owner_uid === identity?.uid);
  const deletable = (calls || []).filter(mine);

  async function confirmDelete() {
    const target = pending;
    setPending(null);
    setBusy(true);
    try {
      if (target === "all") {
        const r = await api.deleteAllCalls();
        const fresh = await api.listCalls();
        setCalls(fresh);
        toast.success(t("del.doneAll", { n: r.deleted }));
      } else {
        await api.deleteCall(target.id);
        setCalls((cs) => cs.filter((c) => c.id !== target.id));
        toast.success(t("del.done"));
      }
    } catch (e) {
      toast.error(t("del.failed"), { description: friendlyError(t, e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title={t("hist.title")}>
      <p className="muted pg-lead">{t("hist.lead")}</p>
      {err && <p className="msg-error" role="alert">{err}</p>}
      {!calls && !err && <p className="muted"><Spinner /> {t("hist.loading")}</p>}
      {calls && calls.length === 0 && <p className="muted">{t("hist.empty")}</p>}
      {deletable.length > 0 && (
        <div className="hist-bar">
          <button className="btn btn-sm btn-danger" onClick={() => setPending("all")} disabled={busy}>
            <Trash2 size={14} aria-hidden="true" />{t("del.all", { n: deletable.length })}
          </button>
        </div>
      )}
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
              {mine(c) && (
                <button className="btn btn-sm btn-danger" onClick={() => setPending(c)} disabled={busy}>
                  <Trash2 size={14} aria-hidden="true" />{t("del.button")}
                </button>
              )}
            </details>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => { if (!o) setPending(null); }}
        title={pending === "all" ? t("del.allTitle") : t("del.title")}
        description={pending === "all" ? t("del.allDesc", { n: deletable.length }) : t("del.desc")}
        confirmLabel={pending === "all" ? t("del.allConfirm") : t("del.confirm")}
        danger
        onConfirm={confirmDelete}
      />
      <Toaster position="bottom-right" theme="dark" visibleToasts={3} closeButton />
    </PageShell>
  );
}
