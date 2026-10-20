import { useCallback, useEffect, useState } from "react";
import { Ear, ExternalLink, FileText, Megaphone, ShieldCheck, ToggleLeft, Users } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { Mark } from "./TopBar";
import LanguageSelect from "./LanguageSelect";
import { useI18n } from "../i18n";
import SlowLoad from "./SlowLoad";

/**
 * Shown once per consent version, before the console loads. The acceptance is stored on the server
 * (who, which version, when). Plain language on purpose: what is heard, who handles it, what is kept.
 */
export default function ConsentGate({ children }) {
  const { logout } = useAuth();
  const { t, lang } = useI18n();
  const [state, setState] = useState({ phase: "loading", version: "", error: "" });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = useCallback(() => {
    setState((s) => ({ ...s, phase: "loading", error: "" }));
    api.consent()
      .then((c) => setState({ phase: c.accepted ? "ok" : "needed", version: c.required_version, error: "" }))
      .catch((e) => setState({ phase: "error", version: "", error: e.message }));
  }, []);
  useEffect(check, [check]);

  async function accept() {
    setBusy(true);
    try {
      await api.acceptConsent(state.version, lang);
      setState((s) => ({ ...s, phase: "ok" }));
    } catch (e) {
      setState((s) => ({ ...s, phase: "error", error: e.message }));
    } finally {
      setBusy(false);
    }
  }

  if (state.phase === "ok") return children;
  if (state.phase === "loading") return <SlowLoad />;
  if (state.phase === "error") {
    return (
      <div className="consent">
        <div className="consent-card">
          <LanguageSelect className="consent-lang" />
          <h1>{t("consent.errorTitle")}</h1>
          <p className="lead">{t("consent.errorBody", { error: state.error })}</p>
          <div className="consent-actions">
            <button className="btn btn-primary" onClick={check}>{t("consent.retry")}</button>
            <button className="btn btn-ghost" onClick={logout}>{t("consent.logout")}</button>
          </div>
        </div>
      </div>
    );
  }

  // one short point each, with a picture so it can be understood at a glance
  const items = [
    ["heard", Ear],
    ["kept", FileText],
    ["others", Megaphone],
    ["helpers", Users],
    ["actions", ToggleLeft],
  ];
  // The claim, terms and conditions live on their own small website so they can be read (and shared) separately.
  const termsBase = import.meta.env.VITE_TERMS_URL || `${window.location.protocol}//${window.location.hostname}:5174/`;
  const termsLink = `${termsBase}${termsBase.includes("?") ? "&" : "?"}lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(state.version)}`;
  return (
    <div className="consent">
      <div className="consent-card" role="dialog" aria-labelledby="consent-title">
        <div className="consent-top">
          <div className="consent-head"><Mark size={26} /><span>Awaaz Shield</span></div>
          <LanguageSelect className="consent-lang" />
        </div>
        <h1 id="consent-title">{t("consent.title")}</h1>
        <p className="lead">{t("consent.lead")}</p>
        <ul className="consent-points">
          {items.map(([k, Icon]) => (
            <li key={k}>
              <span className="pt-icon" aria-hidden="true"><Icon size={20} /></span>
              <div><b>{t(`consent.${k}.h`)}</b><span>{t(`consent.${k}.b`)}</span></div>
            </li>
          ))}
        </ul>
        <a className="terms-link" href={termsLink} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={16} aria-hidden="true" />
          <span>{t("consent.terms")}<small>{t("consent.termsHint")}</small></span>
        </a>
        <label className="consent-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{t("consent.agree")}</span>
        </label>
        <div className="consent-actions">
          <button className="btn btn-primary" disabled={!agreed || busy} onClick={accept}>
            <ShieldCheck size={15} aria-hidden="true" />{t("consent.button")}
          </button>
          <button className="btn btn-ghost" onClick={logout}>{t("consent.logout")}</button>
        </div>
        <p className="consent-foot mono">{t("consent.version", { v: state.version })}</p>
      </div>
    </div>
  );
}
