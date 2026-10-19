import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, Headphones, Link2, LogIn, Mic, MicOff, PhoneCall, PhoneOff, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useT } from "../i18n";
import { Mark } from "../components/TopBar";
import Spinner from "../components/Spinner";
import LanguageSelect from "../components/LanguageSelect";
import { VoiceSession } from "../lib/voiceSession";
import { voiceSupported } from "../lib/voiceAudio";

/**
 * In-app voice call. The person who starts it is the "caller" (the side that is scored); the person who joins with
 * the code is the one being called. Both see the notice and must accept it BEFORE the microphone is opened or the
 * socket is connected; the server then refuses to relay or transcribe anything until both have accepted.
 */
const FRESH = { peer: false, live: false, muted: false, peerMuted: false, finals: [], interim: { caller: "", agent: "" }, risk: null, sttOff: false, startedAt: null };
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const normaliseCode = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function CallRoom() {
  const t = useT();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState("home"); // home | notice | connecting | call | ended
  const [role, setRole] = useState(null); // "host" | "guest"
  const [room, setRoom] = useState(null); // { code, label }
  const [agreed, setAgreed] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState(normaliseCode(params.get("join")));
  const [call, setCall] = useState(FRESH);
  const [endedWhy, setEndedWhy] = useState("you");
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState("");
  const session = useRef(null);
  const phaseRef = useRef(phase);
  const wake = useRef(null);
  const meterMe = useRef(null);
  const meterThem = useRef(null);
  const capsRef = useRef(null);
  phaseRef.current = phase;

  const supported = voiceSupported();

  const releaseWake = () => { try { wake.current?.release(); } catch { /* ignore */ } wake.current = null; };
  const finish = useCallback((why) => {
    session.current?.stop();
    session.current = null;
    releaseWake();
    setEndedWhy(why);
    setPhase("ended");
  }, []);

  useEffect(() => () => { session.current?.stop(); releaseWake(); }, []);

  // level meters: read straight from the session every frame, no React re-render
  useEffect(() => {
    if (phase !== "call") return undefined;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = session.current;
      meterMe.current?.style.setProperty("--lvl", String(s ? s.localLevel.toFixed(3) : 0));
      meterThem.current?.style.setProperty("--lvl", String(s ? s.remoteLevel.toFixed(3) : 0));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (!call.live) return undefined;
    const tick = () => setElapsed(Math.floor((Date.now() - (call.startedAt || Date.now())) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [call.live, call.startedAt]);

  useEffect(() => {
    const el = capsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [call.finals.length, call.interim.caller, call.interim.agent]);

  const serverError = useCallback((m) => {
    const map = { no_room: "voice.errNoRoom", role_taken: "voice.errRoleTaken", not_host: "voice.errNotHost" };
    return map[m.code] ? t(map[m.code]) : m.message || t("voice.errGeneric");
  }, [t]);

  const onEvent = useCallback((m) => {
    switch (m.type) {
      case "joined":
        setCall((c) => ({ ...c, peer: !!m.peer, sttOff: !m.stt }));
        setPhase("call");
        break;
      case "peer":
        setCall((c) => ({ ...c, peer: m.state === "joined", live: m.state === "joined" ? c.live : false, peerMuted: false, startedAt: m.state === "joined" ? c.startedAt : null }));
        break;
      case "live":
        setCall((c) => ({ ...c, live: true, startedAt: c.startedAt || Date.now() }));
        break;
      case "peer_muted":
        setCall((c) => ({ ...c, peerMuted: !!m.muted }));
        break;
      case "caption":
        setCall((c) => m.final
          ? { ...c, finals: [...c.finals, { id: `${Date.now()}-${c.finals.length}`, speaker: m.speaker, text: m.text }].slice(-40), interim: { ...c.interim, [m.speaker]: "" } }
          : { ...c, interim: { ...c.interim, [m.speaker]: m.text } });
        break;
      case "risk":
        setCall((c) => ({ ...c, risk: { score: m.score, level: m.level } }));
        break;
      case "notice":
        if (m.code === "stt_unavailable") setCall((c) => ({ ...c, sttOff: true }));
        break;
      case "ended":
        finish("host");
        break;
      case "error":
        session.current?.stop();
        session.current = null;
        if (phaseRef.current === "connecting" || phaseRef.current === "notice") { setErr(serverError(m)); setPhase("notice"); } else { setErr(serverError(m)); finish("lost"); }
        break;
      case "closed":
        if (phaseRef.current === "call") { setErr(t("voice.errLost")); finish("lost"); }
        else if (phaseRef.current === "connecting") { setErr(t("voice.errLost")); setPhase("notice"); }
        break;
      default:
    }
  }, [finish, serverError, t]);

  function apiError(e) {
    return e?.status === 404 ? t("voice.errNoRoom") : e?.message || t("voice.errGeneric");
  }

  async function startHost() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.startVoiceCall(name.trim() || undefined);
      setRoom({ code: r.code, label: r.label });
      setRole("host");
      setAgreed(false);
      setPhase("notice");
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function joinGuest(e) {
    e?.preventDefault();
    const code = normaliseCode(joinCode);
    if (busy || code.length < 6) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.voiceRoom(code);
      setRoom({ code: r.code, label: r.label });
      setRole("guest");
      setAgreed(false);
      setPhase("notice");
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    if (!agreed || busy) return;
    setBusy(true);
    setErr("");
    setCall(FRESH);
    setElapsed(0);
    const s = new VoiceSession({ code: room.code, role, onEvent });
    session.current = s;
    setPhase("connecting");
    try {
      await s.start();
      try { wake.current = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
    } catch (e) {
      session.current = null;
      setPhase("notice");
      setErr(e?.name === "NotAllowedError" ? t("voice.errDenied") : e?.name === "NotFoundError" ? t("voice.errNoMic") : t("voice.errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function toggleMute() {
    const next = !call.muted;
    session.current?.setMuted(next);
    setCall((c) => ({ ...c, muted: next }));
  }

  function hangup() {
    session.current?.hangup();
    session.current = null;
    releaseWake();
    setEndedWhy("you");
    setPhase("ended");
  }

  function reset() {
    setPhase("home");
    setRole(null);
    setRoom(null);
    setErr("");
    setCall(FRESH);
    setJoinCode("");
  }

  const inviteLink = room ? `${location.origin}/call?join=${room.code}` : "";
  async function copy(what, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1800);
    } catch { /* clipboard can be blocked: the code is on screen anyway */ }
  }

  const me = role === "host" ? "caller" : "agent";
  const scary = role === "guest" && call.risk && (call.risk.level === "high" || call.risk.level === "critical");

  return (
    <div className="vc-page">
      <header className="vc-top">
        <button className="btn btn-ghost btn-sm" onClick={() => (phase === "call" || phase === "connecting" ? null : navigate("/dashboard"))} disabled={phase === "call" || phase === "connecting"}>
          <ArrowLeft size={14} aria-hidden="true" />{t("voice.toDashboard")}
        </button>
        <div className="vc-brand"><Mark size={22} /><span>Awaaz Shield</span></div>
        <div className="vc-top-right"><LanguageSelect />{identity && <span className="email" title={identity.email}>{identity.email}</span>}</div>
      </header>

      <main className="vc-main">
        {phase === "home" && (
          <div className="vc-grid">
            {!supported && <p className="msg-error vc-wide" role="alert">{t("voice.errInsecure")}</p>}
            <section className="vc-card">
              <h2><PhoneCall size={18} aria-hidden="true" />{t("voice.startTitle")}</h2>
              <p className="muted">{t("voice.startDesc")}</p>
              <label className="vc-field">{t("voice.nameLabel")}
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("voice.namePlaceholder")} maxLength={60} />
              </label>
              <button className="btn btn-primary" onClick={startHost} disabled={busy || !supported} aria-busy={busy}>
                {busy ? <Spinner /> : <PhoneCall size={14} aria-hidden="true" />}{t("voice.startBtn")}
              </button>
            </section>
            <section className="vc-card">
              <h2><LogIn size={18} aria-hidden="true" />{t("voice.joinTitle")}</h2>
              <p className="muted">{t("voice.joinDesc")}</p>
              <form onSubmit={joinGuest} className="vc-join">
                <input
                  className="vc-code-input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(normaliseCode(e.target.value).slice(0, 6))}
                  placeholder="ABC123"
                  aria-label={t("voice.codeLabel")}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                />
                <button className="btn btn-primary" disabled={busy || joinCode.length < 6 || !supported} aria-busy={busy}>
                  {busy ? <Spinner /> : <LogIn size={14} aria-hidden="true" />}{t("voice.joinBtn")}
                </button>
              </form>
            </section>
            {err && <p className="msg-error vc-wide" role="alert">{err}</p>}
            <p className="vc-tip vc-wide"><Headphones size={14} aria-hidden="true" />{t("voice.headphones")}</p>
          </div>
        )}

        {(phase === "notice" || phase === "connecting") && (
          <section className="vc-card vc-notice" aria-labelledby="vc-notice-title">
            <h2 id="vc-notice-title"><ShieldCheck size={18} aria-hidden="true" />{t("voice.noticeTitle")}</h2>
            <ul>
              <li>{t("voice.notice1")}</li>
              <li>{t("voice.notice2")}</li>
              <li>{t("voice.notice3")}</li>
              <li>{t("voice.notice4")}</li>
            </ul>
            {role === "host" && (
              <div className="vc-codebox" aria-live="polite">
                <span className="eyebrow">{t("voice.shareCode")}</span>
                <b className="vc-code">{room?.code}</b>
              </div>
            )}
            <label className="vc-agree">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={phase === "connecting"} />
              <span>{t("voice.agree")}</span>
            </label>
            {err && <p className="msg-error" role="alert">{err}</p>}
            <div className="vc-actions">
              <button className="btn" onClick={() => { session.current?.stop(); session.current = null; reset(); }} disabled={phase === "connecting"}>{t("voice.back")}</button>
              <button className="btn btn-primary" onClick={begin} disabled={!agreed || busy} aria-busy={phase === "connecting"}>
                {phase === "connecting" ? <Spinner /> : <PhoneCall size={14} aria-hidden="true" />}
                {phase === "connecting" ? t("voice.connecting") : role === "host" ? t("voice.noticeStart") : t("voice.noticeJoin")}
              </button>
            </div>
          </section>
        )}

        {phase === "call" && (
          <div className="vc-call">
            <section className="vc-card vc-status" aria-live="polite">
              <div className="vc-status-top">
                <span className={`status-chip ${call.live ? "live" : ""}`}>{call.live ? t("voice.live") : t("voice.waiting")}</span>
                <h2>{room?.label}</h2>
                {call.live && <span className="mono vc-clock">{clock(elapsed)}</span>}
              </div>
              {!call.live && (
                <p className="muted">
                  {role === "host" ? (call.peer ? t("voice.waitAccept") : t("voice.waitJoin")) : t("voice.waitLive")}
                </p>
              )}
              {role === "host" && !call.live && (
                <div className="vc-codebox">
                  <span className="eyebrow">{t("voice.shareCode")}</span>
                  <b className="vc-code">{room?.code}</b>
                  <div className="vc-actions">
                    <button className="btn btn-sm" onClick={() => copy("code", room.code)}>{copied === "code" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied === "code" ? t("voice.copied") : t("voice.copy")}</button>
                    <button className="btn btn-sm" onClick={() => copy("link", inviteLink)}>{copied === "link" ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}{copied === "link" ? t("voice.copied") : t("voice.copyLink")}</button>
                  </div>
                </div>
              )}
              {call.sttOff && <p className="msg-error" role="status">{t("voice.sttOff")}</p>}
              {role === "host" && call.live && !call.sttOff && <p className="vc-chip-note"><ShieldCheck size={14} aria-hidden="true" />{t("voice.monitored")}</p>}
              {role === "guest" && call.risk && !scary && <p className="vc-chip-note"><ShieldCheck size={14} aria-hidden="true" />{t("voice.riskNow", { level: t(`level.${call.risk.level}`) })}</p>}
            </section>

            {scary && (
              <section className="vc-warn" role="alert">
                <ShieldAlert size={22} aria-hidden="true" />
                <div><b>{t("voice.warnTitle")}</b><p>{t("voice.warnBody")}</p></div>
              </section>
            )}

            <section className="vc-card vc-people">
              <div className="vc-person"><span className="vc-meter" ref={meterMe}><i /></span><b>{t("voice.you")}</b>{call.muted && <span className="badge-muted">{t("voice.muted")}</span>}</div>
              <div className="vc-person"><span className="vc-meter" ref={meterThem}><i /></span><b>{t("voice.them")}</b>{call.peerMuted && <span className="badge-muted">{t("voice.muted")}</span>}{!call.peer && <span className="badge-muted">{t("voice.notHere")}</span>}</div>
            </section>

            <section className="vc-card vc-caps">
              <h3>{t("voice.captions")}</h3>
              <div className="vc-log" ref={capsRef} role="log" aria-live="off" tabIndex={0} aria-label={t("voice.captions")}>
                {call.finals.length === 0 && !call.interim.caller && !call.interim.agent && <p className="muted">{t("voice.noCaptions")}</p>}
                {call.finals.map((c) => (
                  <p key={c.id} className={`vc-line ${c.speaker === me ? "mine" : "theirs"}`}><b>{c.speaker === me ? t("voice.you") : t("voice.them")}</b> {c.text}</p>
                ))}
                {["caller", "agent"].map((sp) => call.interim[sp] && (
                  <p key={`i-${sp}`} className={`vc-line interim ${sp === me ? "mine" : "theirs"}`}><b>{sp === me ? t("voice.you") : t("voice.them")}</b> {call.interim[sp]}</p>
                ))}
              </div>
            </section>

            <div className="vc-controls">
              <button className={`btn vc-round ${call.muted ? "on" : ""}`} onClick={toggleMute} aria-pressed={call.muted} aria-label={call.muted ? t("voice.unmute") : t("voice.mute")}>
                {call.muted ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
                <span>{call.muted ? t("voice.unmute") : t("voice.mute")}</span>
              </button>
              <button className="btn vc-round hang" onClick={hangup} aria-label={role === "host" ? t("voice.hangup") : t("voice.leave")}>
                <PhoneOff size={20} aria-hidden="true" />
                <span>{role === "host" ? t("voice.hangup") : t("voice.leave")}</span>
              </button>
            </div>
            <p className="vc-tip"><Headphones size={14} aria-hidden="true" />{t("voice.headphones")}</p>
          </div>
        )}

        {phase === "ended" && (
          <section className="vc-card vc-ended">
            <h2><PhoneOff size={18} aria-hidden="true" />{t("voice.ended")}</h2>
            <p className="muted">{endedWhy === "host" ? t("voice.endedByHost") : endedWhy === "lost" ? t("voice.endedLost") : t("voice.endedYou")}</p>
            {err && <p className="msg-error" role="alert">{err}</p>}
            <div className="vc-actions">
              <button className="btn" onClick={() => navigate("/dashboard")}>{t("voice.toDashboard")}</button>
              <button className="btn btn-primary" onClick={reset}><PhoneCall size={14} aria-hidden="true" />{t("voice.again")}</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
