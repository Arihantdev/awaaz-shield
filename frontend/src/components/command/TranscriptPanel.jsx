import { useLayoutEffect, useRef } from "react";
import { useT } from "../../i18n";

const clock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour12: false });
};

export default function TranscriptPanel({ call }) {
  const t = useT();
  const ref = useRef(null);
  const lines = call?.transcript || [];
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <section className="cc-panel cc-fill" aria-label={t("cc.transcript")}>
      <header className="cc-panel-bar">
        <h3>{t("cc.transcript")}</h3>
        <span className="mono cc-muted">{call ? call.label : t("cc.noFocus")}</span>
      </header>
      <ol ref={ref} data-lenis-prevent className="cc-lines" role="log" aria-live="off">
        {!call && <li className="cc-empty">{t("cc.pickCall")}</li>}
        {call && lines.length === 0 && <li className="cc-empty">{t("cc.waiting")}</li>}
        {lines.map((l) => (
          <li key={l.id} className={`cc-line sp-${l.speaker}`}>
            <span className="cc-sp">{t(`speaker.${l.speaker}`)}</span>
            <span className="cc-tx">{l.text}</span>
            <time className="mono">{clock(l.ts)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
