import { useEffect, useRef, useState } from "react";
import { Info, Send, ShieldAlert } from "lucide-react";
import { api } from "../api";
import { useT } from "../i18n";
import RiskBadge from "./RiskBadge";
import Spinner from "./Spinner";

/**
 * Risk-evaluator chat. The person asks about a call ("They are asking for my OTP. Is that dangerous?") and the
 * backend answers from the call's transcript and/or what they typed. The card always says which of those the answer
 * rests on, and shows NO score when there is no evidence, so the screen never pretends to know more than it does.
 */
const SUGGESTIONS = ["ev.s1", "ev.s2", "ev.s3", "ev.s4", "ev.s5"];

function errorText(t, e) {
  if (e?.status === 429) return t("ev.errRate");
  if (e?.status === 404) return t("ev.errGone");
  if (e?.status === 401) return t("ev.errAuth");
  if (e?.status >= 500) return t("ev.errServer");
  return t("ev.errNetwork");
}

function Answer({ ev, t }) {
  return (
    <div className="ev-card">
      <div className="ev-head">
        {ev.score == null
          ? <span className="badge-muted">{t("ev.noScore")}</span>
          : <RiskBadge score={ev.score} level={ev.level} />}
        <span className="ev-basis" data-basis={ev.basis}>{t(`ev.basis.${ev.basis}`)}</span>
      </div>
      <p className="ev-answer">{ev.answer}</p>
      <p className="ev-note"><Info size={13} aria-hidden="true" />{ev.basis_note}</p>
      {ev.warning_signs.length > 0 && (
        <div className="ev-sec">
          <h4>{t("ev.signs")}</h4>
          <ul>{ev.warning_signs.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {ev.recommended_steps.length > 0 && (
        <div className="ev-sec">
          <h4>{t("ev.steps")}</h4>
          <ul>{ev.recommended_steps.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      <p className="ev-disclaimer">{ev.disclaimer}</p>
    </div>
  );
}

export default function EvaluatorChat({ callId }) {
  const t = useT();
  const [items, setItems] = useState([]); // { id, role: "me" | "ev" | "err", text?, ev? }
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const canAsk = !!callId;

  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const last = items[items.length - 1];
    const cards = el.querySelectorAll(".ev-card");
    if (!busy && last?.role === "ev" && cards.length) {
      // a new answer: show it from its top (score and basis first), not from its bottom
      const card = cards[cards.length - 1];
      el.scrollTop = card.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 4;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(text) {
    const message = (text ?? draft).trim();
    if (!message || busy || !canAsk) return;
    const id = ++seq.current;
    setItems((xs) => [...xs, { id: `m${id}`, role: "me", text: message }]);
    setDraft("");
    setBusy(true);
    try {
      const ev = await api.evaluate(callId, message);
      if (alive.current) setItems((xs) => [...xs, { id: `e${id}`, role: "ev", ev }]);
    } catch (e) {
      if (alive.current) setItems((xs) => [...xs, { id: `x${id}`, role: "err", text: errorText(t, e), retry: message }]);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="ev">
      <p className="ev-intro">{t("ev.intro")}</p>
      <div className="ev-log" ref={logRef} role="log" aria-live="polite" aria-label={t("ev.title")} tabIndex={0}>
        {items.length === 0 && (
          <div className="ev-sugg">
            {SUGGESTIONS.map((k) => (
              <button key={k} type="button" className="ev-chip" onClick={() => ask(t(k))} disabled={!canAsk || busy}>{t(k)}</button>
            ))}
          </div>
        )}
        {items.map((it) => it.role === "me" ? (
          <p key={it.id} className="ev-me">{it.text}</p>
        ) : it.role === "err" ? (
          <p key={it.id} className="ev-err" role="alert">
            <ShieldAlert size={14} aria-hidden="true" />{it.text}
            {it.retry && <button type="button" className="btn btn-sm" onClick={() => ask(it.retry)} disabled={busy}>{t("ev.retry")}</button>}
          </p>
        ) : (
          <Answer key={it.id} ev={it.ev} t={t} />
        ))}
        {busy && <p className="ev-busy" role="status"><Spinner />{t("ev.thinking")}</p>}
      </div>
      {!canAsk && <p className="ev-note">{t("ev.noCall")}</p>}
      <form className="ev-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("ev.placeholder")}
          aria-label={t("ev.placeholder")}
          maxLength={2000}
          disabled={!canAsk}
          enterKeyHint="send"
        />
        <button className="btn btn-primary" disabled={!draft.trim() || busy || !canAsk} aria-label={t("ev.send")}>
          <Send size={14} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
