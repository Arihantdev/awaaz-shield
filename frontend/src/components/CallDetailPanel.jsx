import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowDown, Ban, Undo2, FlaskConical, Flag, Megaphone, Mic, PhoneCall, PhoneOff, Phone, Send, ShieldAlert, StickyNote } from "lucide-react";
import { api } from "../api";
import { friendlyError } from "../lib/errors";
import { signalLabel, useI18n } from "../i18n";
import ShieldCore from "../three/LazyShieldCore";
import RiskGauge from "./RiskGauge";
import RiskChart from "./RiskChart";
import MicCapture from "./MicCapture";
import LiveAudio from "./LiveAudio";
import Spinner from "./Spinner";
import SignalWave from "./SignalWave";
import { micLevel } from "../lib/micLevel";

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const NEAR_BOTTOM_PX = 80;

/** Where the call's lines come from: tells the operator at a glance whether this is a demonstration or a real line. */
function SourceChip({ call, t }) {
  if (call.source === "phone") return <span className="status-chip mode-live"><PhoneCall size={12} aria-hidden="true" />{t("call.phoneLine")}</span>;
  if (call.source === "voice") return <span className="status-chip mode-live" title={t("call.voiceTitle")}><Phone size={12} aria-hidden="true" />{t("call.voice")}</span>;
  if (call.source === "microphone") return <span className="status-chip mode-demo" title={t("call.demoTitle")}><Mic size={12} aria-hidden="true" />{t("call.micSource")}</span>;
  return <span className="status-chip mode-demo" title={t("call.demoTitle")}><FlaskConical size={12} aria-hidden="true" />{t("call.demo")}</span>;
}

export default function CallDetailPanel({ call, onChanged, deepgramAvailable = false }) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState("");
  const [speaker, setSpeaker] = useState("caller");
  const [sending, setSending] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [busyKey, setBusyKey] = useState(null); // one operator action at a time, so a double click cannot record twice
  const [listening, setListening] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const chatRef = useRef(null);
  const stickRef = useRef(true); // follow new lines only while the operator is already at the bottom
  const seenLines = useRef(0);
  const levelRef = micLevel; // microphone level 0..1, written by MicCapture, read by the 3D scenes
  const lines = call.transcript.length;

  const scrollToEnd = useCallback(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // switching calls: start at the latest line
  useLayoutEffect(() => {
    stickRef.current = true;
    seenLines.current = call.transcript.length;
    setUnseen(0);
    scrollToEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.id]);

  // new lines: follow only if the reader is at the bottom, otherwise show a "jump to latest" prompt
  useEffect(() => {
    const added = lines - seenLines.current;
    seenLines.current = lines;
    if (added <= 0) return;
    if (stickRef.current) scrollToEnd();
    else setUnseen((n) => n + added);
  }, [lines, scrollToEnd]);

  function onChatScroll() {
    const el = chatRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stickRef.current = near;
    if (near) setUnseen(0);
  }

  const fail = (err) => toast.error(t("dash.actionFailed"), { description: friendlyError(t, err) });

  const sigList = (list) => (list || []).map((s) => signalLabel(t, s)).join(", ");
  const explanation =
    lang === "en"
      ? call.last_explanation || t("call.waiting")
      : call.transcript.length === 0
        ? t("call.waiting")
        : call.signals.length
          ? t("call.explain", { list: sigList(call.signals), score: call.current_score })
          : t("call.explainNone");

  /** Sends one transcript line (typed or from the microphone). Returns true when the backend accepted it. */
  async function sendChunk(text, who = speaker) {
    if (!text.trim()) return false;
    try {
      await api.ingest(call.id, text.trim(), who);
      onChanged();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      if (await sendChunk(draft)) setDraft("");
    } finally {
      setSending(false);
    }
  }

  async function guarded(key, fn) {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusyKey(null);
    }
  }

  const recordAction = (type) =>
    guarded(type, async () => {
      await api.recordAction(call.id, type, type === "note" ? noteDraft : "");
      if (type === "note") setNoteDraft("");
      onChanged();
    });
  const endCall = () => guarded("end", async () => { await api.endCall(call.id); onChanged(); });

  const hasLines = lines > 0;

  return (
    <>
      <main className="stage">
        <section className={`summary risk-${call.current_level}`} aria-label={t("call.overview")}>
          <div className="summary-top">
            <div>
              <h2>{call.label}</h2>
              <div className="sub">
                <span className={`status-chip ${call.status === "active" ? "live" : ""}`}>{call.status === "active" ? t("status.inProgress") : t("status.ended")}</span>
                <SourceChip call={call} t={t} />
                {call.notice_given && <span className="status-chip" title={t("call.noticeTitle")}><Megaphone size={12} aria-hidden="true" />{t("call.notice")}</span>}
                <span className="mono">{t("call.started", { time: time(call.started_at) })}</span>
              </div>
            </div>
            <div className="actions">
              {call.disposition && <span className={`badge-muted disp disp-${call.disposition}`}>{t(`disp.${call.disposition}`)}</span>}
              {call.status === "active" && (
                <button className="btn btn-sm" onClick={endCall} disabled={!!busyKey} aria-busy={busyKey === "end"}>
                  {busyKey === "end" ? <Spinner /> : <PhoneOff size={14} aria-hidden="true" />}{t("call.end")}
                </button>
              )}
            </div>
          </div>

          <div className="summary-body">
            <RiskGauge score={call.current_score} level={call.current_level} />
            <div className="summary-copy" aria-live="polite">
              <h3 className="eyebrow">{t("call.why")}</h3>
              <p>{explanation}</p>
              {call.signals.length > 0 ? (
                <ul className="sig-chips" aria-label={t("call.tactics")}>
                  {call.signals.map((s) => <li key={s} className="sig-chip">{signalLabel(t, s)}</li>)}
                </ul>
              ) : (
                hasLines && <p className="muted">{t("call.noSignals")}</p>
              )}
            </div>
            <div className="summary-3d">
              <ShieldCore level={hasLines ? call.current_level : null} listening={listening} levelRef={levelRef} />
            </div>
          </div>
        </section>

        <motion.section key={`chart-${call.id}`} className="block" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <h3>
            {t("call.riskOverTime")}
            <span className="badge-muted">{t("call.scoredBy", { scorer: call.scorer })}</span>
          </h3>
          <RiskChart history={call.risk_history} />
        </motion.section>

        <motion.section key={`tr-${call.id}`} className="block transcript-block" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.04 }}>
          <h3>{t("call.transcript")}</h3>
          <SignalWave level={hasLines ? call.current_level : "low"} active={call.status === "active" && listening} />
          <div className="chat-wrap">
            <div className="chat" ref={chatRef} onScroll={onChatScroll} role="log" aria-live="polite" tabIndex={0} aria-label={t("call.transcript")}>
              {call.transcript.length === 0 && <p className="empty-note" style={{ padding: 0 }}>{t("call.noLines")}</p>}
              <AnimatePresence initial={false}>
                {call.transcript.map((chunk) => (
                  <motion.div
                    key={chunk.id}
                    className={`msg ${chunk.speaker === "agent" ? "agent" : "caller"}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
                    <span className="who">
                      <b>{t(`speaker.${chunk.speaker === "agent" ? "agent" : "caller"}`)}</b> · <span className="mono">{time(chunk.ts)}</span>
                    </span>
                    <span className="bubble">{chunk.text}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {unseen > 0 && (
                <motion.button
                  type="button"
                  className="jump-latest"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.16 }}
                  onClick={() => { stickRef.current = true; setUnseen(0); scrollToEnd(); }}
                >
                  <ArrowDown size={14} aria-hidden="true" />{t("call.newLines", { n: unseen })}
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {call.status === "active" && call.source !== "voice" && (
            <form onSubmit={handleSubmit} className="ingest">
              <select value={speaker} onChange={(e) => setSpeaker(e.target.value)} aria-label={t("call.speaker")}>
                <option value="caller">{t("speaker.caller")}</option>
                <option value="agent">{t("speaker.agent")}</option>
              </select>
              <input
                type="text"
                className="grow"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("call.next")}
                aria-label={t("call.nextAria")}
              />
              <MicCapture speaker={speaker} onChunk={sendChunk} levelRef={levelRef} onListeningChange={setListening} />
              <button className="btn btn-primary" disabled={sending || !draft.trim()} aria-busy={sending}>
                {sending ? <Spinner /> : <Send size={14} aria-hidden="true" />}{t("call.send")}
              </button>
            </form>
          )}
          {call.status === "active" && call.source !== "voice" && (
            <LiveAudio callId={call.id} speaker={speaker} available={deepgramAvailable} onChanged={onChanged} onListeningChange={setListening} />
          )}
        </motion.section>
      </main>

      <aside className="side">
        <section className="block">
          <h3>{t("call.actions")}</h3>
          {call.disposition === "dismissed" && (
            <div className="history-note" role="status">
              <p>{t("call.inHistory")}</p>
              <button className="btn btn-sm btn-primary" disabled={!!busyKey} aria-busy={busyKey === "restored"} onClick={() => recordAction("restored")}>
                {busyKey === "restored" ? <Spinner /> : <Undo2 size={14} aria-hidden="true" />}{t("call.restore")}
              </button>
            </div>
          )}
          <div className="act-row">
            <button className="btn btn-sm" disabled={!!busyKey} onClick={() => recordAction("flagged")}><Flag size={14} aria-hidden="true" />{t("call.flag")}</button>
            <button className="btn btn-sm btn-danger" disabled={!!busyKey} onClick={() => recordAction("escalated")}><ShieldAlert size={14} aria-hidden="true" />{t("call.escalate")}</button>
            <button className="btn btn-sm" disabled={!!busyKey} onClick={() => recordAction("dismissed")}><Ban size={14} aria-hidden="true" />{t("call.dismiss")}</button>
          </div>
          <div className="act-row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
            <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder={t("call.notePlaceholder")} aria-label={t("call.noteAria")} style={{ flex: 1 }} />
            <button className="btn btn-sm" disabled={!noteDraft.trim() || !!busyKey} onClick={() => recordAction("note")}><StickyNote size={14} aria-hidden="true" />{t("call.addNote")}</button>
          </div>
          {call.actions.length > 0 && (
            <ul className="log">
              {[...call.actions].reverse().map((a) => (
                <li key={a.id}>
                  <span className="mono">{time(a.ts)}</span> · {["flagged", "escalated", "dismissed", "restored", "note"].includes(a.type) ? t(`disp.${a.type}`) : a.type}
                  {a.note ? `: ${a.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </>
  );
}
