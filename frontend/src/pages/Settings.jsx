import { useEffect, useState } from "react";
import { LogOut, Mic, Trash2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useT } from "../i18n";
import PageShell from "../components/PageShell";
import LanguageSelect from "../components/LanguageSelect";
import Spinner from "../components/Spinner";
import InstallHelp from "../components/InstallHelp";
import ConfirmDialog from "../components/ConfirmDialog";
import { friendlyError } from "../lib/errors";

/** Everything here reports what is really configured; nothing is a switch that does not do anything. */
export default function Settings() {
  const t = useT();
  const { identity, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [mic, setMic] = useState("unknown"); // granted | denied | prompt | unknown | unsupported
  const [testing, setTesting] = useState(false);
  const [micMsg, setMicMsg] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteAll() {
    setDeleting(true);
    try {
      const r = await api.deleteAllCalls();
      toast.success(t("del.doneAll", { n: r.deleted }) + (r.skipped_active ? " " + t("del.skipped", { n: r.skipped_active }) : ""));
    } catch (e) {
      toast.error(t("del.failed"), { description: friendlyError(t, e) });
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(false));
    let perm;
    const read = () => setMic(perm.state);
    navigator.permissions?.query({ name: "microphone" })
      .then((p) => { perm = p; read(); p.onchange = read; })
      .catch(() => setMic("unknown")); // Safari does not report microphone permission
    return () => { if (perm) perm.onchange = null; };
  }, []);

  async function testMic() {
    setTesting(true);
    setMicMsg("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("x"), { name: "Unsupported" });
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((tr) => tr.stop()); // only checking access: nothing is recorded
      setMic("granted");
      setMicMsg(t("set.micOk"));
    } catch (e) {
      setMicMsg(e?.name === "NotAllowedError" ? t("voice.errDenied") : e?.name === "NotFoundError" ? t("voice.errNoMic") : e?.name === "Unsupported" ? t("voice.errInsecure") : t("voice.errGeneric"));
      if (e?.name === "NotAllowedError") setMic("denied");
    } finally {
      setTesting(false);
    }
  }

  const yes = (v) => (v ? t("set.on") : t("set.off"));
  const th = status?.risk_thresholds;

  return (
    <PageShell title={t("set.title")}>
      <div className="set-grid">
        <section className="vc-card">
          <h2>{t("set.account")}</h2>
          <p>{identity?.email}{identity?.dev_mode && <span className="badge-muted" style={{ marginLeft: 8 }}>{t("top.devMode")}</span>}</p>
          <div className="set-row"><span>{t("set.language")}</span><LanguageSelect /></div>
          <button className="btn" onClick={logout}><LogOut size={14} aria-hidden="true" />{t("top.logout")}</button>
        </section>

        <InstallHelp />

        <section className="vc-card">
          <h2><Mic size={18} aria-hidden="true" />{t("set.mic")}</h2>
          <p className="muted">{t("set.micDesc")}</p>
          <p>{t("set.micState")}: <b>{t(`set.mic.${mic}`)}</b></p>
          <button className="btn" onClick={testMic} disabled={testing} aria-busy={testing}>{testing ? <Spinner /> : <Mic size={14} aria-hidden="true" />}{t("set.micTest")}</button>
          {micMsg && <p className="muted" role="status">{micMsg}</p>}
          <p className="muted">{t("set.micHelp")}</p>
        </section>

        <section className="vc-card">
          <h2>{t("set.privacy")}</h2>
          <ul className="set-list">
            <li>{t("set.priv1")}</li>
            <li>{t("set.priv2")}</li>
            <li>{status ? (status.firestore_persistence ? t("set.privSaved") : t("set.privMemory")) : "…"}</li>
            <li>{t("set.priv3")}</li>
            <li>{status?.retention_days > 0 ? t("set.privRetention", { n: status.retention_days }) : t("set.privKeep")}</li>
          </ul>
          <button className="btn btn-danger" onClick={() => setConfirmAll(true)} disabled={deleting} aria-busy={deleting}>
            {deleting ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}{t("del.settingsBtn")}
          </button>
          <p className="muted">{t("del.settingsHelp")}</p>
        </section>

        <section className="vc-card">
          <h2>{t("set.server")}</h2>
          {status === false && <p className="msg-error" role="alert">{t("ev.errNetwork")}</p>}
          {status && (
            <dl className="set-dl">
              <dt>{t("set.scoring")}</dt><dd>{status.scoring_backend === "claude" ? "Claude" : t("set.rules")}</dd>
              <dt>{t("set.stt")}</dt><dd>{yes(status.deepgram_stt)}</dd>
              <dt>{t("set.access")}</dt><dd>{status.call_access_restricted ? t("set.accessOwn") : t("set.accessAll")}</dd>
              {th && <><dt>{t("set.bands")}</dt><dd className="mono">{th.medium} / {th.high} / {th.critical}</dd></>}
            </dl>
          )}
        </section>

        <section className="vc-card set-wide">
          <h2>{t("set.limits")}</h2>
          <ul className="set-list">
            <li>{t("set.lim1")}</li>
            <li>{t("set.lim2")}</li>
            <li>{t("set.lim3")}</li>
            <li>{t("set.lim4")}</li>
          </ul>
        </section>
      </div>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t("del.allTitle")}
        description={t("del.allDescNoCount")}
        confirmLabel={t("del.allConfirm")}
        danger
        onConfirm={deleteAll}
      />
      <Toaster position="bottom-right" theme="dark" visibleToasts={3} closeButton />
    </PageShell>
  );
}
