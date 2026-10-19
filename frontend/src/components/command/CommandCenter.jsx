import { useEffect, useMemo, useRef } from "react";
import { Radio } from "lucide-react";
import LazyRiskLandscape from "../../three/LazyRiskLandscape";
import CommandCards from "./CommandCards";
import ThreatPanel from "./ThreatPanel";
import TranscriptPanel from "./TranscriptPanel";
import EventStream from "./EventStream";
import GlowCursor from "./GlowCursor";
import { useLenis } from "../../hooks/useLenis";
import { playThreatFx } from "../../lib/threatFx";
import { buildLandscape } from "../../lib/riskLandscape";
import { LEVELS, LEVEL_HEX, isHighRisk } from "../../lib/risk";
import { useT } from "../../i18n";

const latestAlert = (calls) => {
  let best = null;
  for (const c of calls) {
    const a = c.alerts?.[c.alerts.length - 1];
    if (a && (!best || Date.parse(a.ts) > Date.parse(best.ts))) best = a;
  }
  return best;
};

/** The call being followed: the one picked on the left, otherwise the newest active call, otherwise the newest. */
function pickFocus(calls, selectedId) {
  const chosen = calls.find((c) => c.id === selectedId);
  if (chosen) return chosen;
  const byStart = [...calls].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  return byStart.find((c) => c.status === "active") || byStart[0] || null;
}

export default function CommandCenter({ calls, selectedId, wsStatus, onChanged, onOpenCall, onError }) {
  const t = useT();
  const scroller = useRef(null);
  const frame = useRef(null);
  const seenAlert = useRef(null);

  useLenis(scroller);

  const focus = useMemo(() => pickFocus(calls, selectedId), [calls, selectedId]);
  const landscape = useMemo(() => buildLandscape(calls, focus?.id ?? null), [calls, focus?.id]);
  const inThreat = !!focus && !!focus.alerts?.length && isHighRisk(focus.current_level);

  // Cursor/backdrop glow turns red while the followed call is in a threat state.
  useEffect(() => {
    document.documentElement.classList.toggle("cc-threat", inThreat);
    return () => document.documentElement.classList.remove("cc-threat");
  }, [inThreat]);

  // New alert anywhere: play the GSAP sequence. Alerts that already exist when the view opens stay quiet.
  const alert = latestAlert(calls);
  useEffect(() => {
    if (!alert) return undefined;
    if (seenAlert.current === null) {
      seenAlert.current = alert.id;
      return undefined;
    }
    if (alert.id === seenAlert.current) return undefined;
    seenAlert.current = alert.id;
    if (!isHighRisk(alert.level)) return undefined;
    const tl = playThreatFx({
      frame: frame.current,
      cards: [...document.querySelectorAll(".cc-flash")],
      panel: document.querySelector(".cc-threat"),
    });
    return () => tl.kill();
  }, [alert]);
  useEffect(() => {
    if (seenAlert.current === null && !alert) seenAlert.current = ""; // nothing yet; the first alert that arrives is new
  }, [alert]);

  return (
    <div className="cc-scroll" ref={scroller}>
      <GlowCursor />
      <div className="cc-frame" ref={frame} aria-hidden="true" />
      <div className="cc-inner">
        <header className="cc-head">
          <div>
            <p className="eyebrow"><Radio size={13} aria-hidden="true" />{t("cc.eyebrow")}</p>
            <h2>{t("cc.title")}</h2>
          </div>
          <p className="cc-sub mono">{focus ? t("cc.focus", { label: focus.label }) : t("cc.noFocus")}</p>
        </header>

        <CommandCards call={focus} calls={calls} />

        <div className="cc-row cc-row-a">
          <section className="cc-panel cc-land" aria-label={t("cc.land")}>
            <header className="cc-panel-bar">
              <h3>{t("cc.land")}</h3>
              <ul className="cc-legend" aria-hidden="true">
                {LEVELS.map((l) => <li key={l}><i style={{ background: LEVEL_HEX[l] }} />{t(`level.${l}`)}</li>)}
              </ul>
            </header>
            <div className="cc-land-stage">
              <LazyRiskLandscape data={landscape} />
              {landscape.count === 0 && <p className="cc-land-empty">{t("cc.landEmpty")}</p>}
            </div>
            <p className="cc-land-hint">{t("cc.landHint")}</p>
          </section>
          <ThreatPanel call={focus} calls={calls} onChanged={onChanged} onOpenCall={onOpenCall} onError={onError} />
        </div>

        <div className="cc-row cc-row-b">
          <TranscriptPanel call={focus} />
          <EventStream calls={calls} wsStatus={wsStatus} />
        </div>
      </div>
    </div>
  );
}
