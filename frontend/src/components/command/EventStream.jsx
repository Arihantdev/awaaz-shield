import { useLayoutEffect, useMemo, useRef } from "react";
import { buildEventLog } from "../../lib/eventLog";
import { animateNewLines } from "../../lib/threatFx";
import { useT } from "../../i18n";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|\b(true|false|null)\b/gi;

function Json({ value }) {
  const text = JSON.stringify(value);
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(<span key={i++} className="j-p">{text.slice(last, m.index)}</span>);
    if (m[1]) {
      out.push(<span key={i++} className={m[2] ? "j-k" : "j-s"}>{m[1]}</span>);
      if (m[2]) out.push(<span key={i++} className="j-p">{m[2]}</span>);
    } else if (m[3]) out.push(<span key={i++} className="j-n">{m[3]}</span>);
    else out.push(<span key={i++} className="j-l">{m[4]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={i++} className="j-p">{text.slice(last)}</span>);
  return <>{out}</>;
}

const time = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(11, 23);
};

export default function EventStream({ calls, wsStatus }) {
  const t = useT();
  const events = useMemo(() => buildEventLog(calls), [calls]);
  const scroller = useRef(null);
  const stick = useRef(true);
  const seen = useRef(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keys = events.map((e) => e.key);
    if (seen.current === null) {
      seen.current = new Set(keys); // lines already on screen at mount do not animate
    } else {
      const fresh = [...el.querySelectorAll("[data-key]")].filter((n) => !seen.current.has(n.dataset.key));
      fresh.forEach((n) => seen.current.add(n.dataset.key));
      animateNewLines(fresh);
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [events]);

  const onScroll = () => {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  return (
    <section className="cc-panel cc-fill" aria-label={t("cc.events")}>
      <header className="cc-panel-bar">
        <h3>{t("cc.events")}</h3>
        <span className="mono cc-muted">{t("cc.eventsCount", { n: events.length })} · {wsStatus}</span>
      </header>
      <div ref={scroller} onScroll={onScroll} data-lenis-prevent className="cc-log mono" role="log" aria-live="off">
        {events.length === 0 && <p className="cc-empty">{t("cc.noEvents")}</p>}
        {events.map(({ key, ...entry }) => (
          <div key={key} data-key={key} className={`cc-log-line lv-${entry.level}`}>
            <i aria-hidden="true" />
            <code><Json value={{ ...entry, ts: time(entry.ts) }} /></code>
          </div>
        ))}
      </div>
    </section>
  );
}
