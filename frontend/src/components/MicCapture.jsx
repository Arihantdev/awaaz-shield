import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { useT } from "../i18n";

const SpeechRecognitionImpl =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const speechSupported = Boolean(SpeechRecognitionImpl);

/**
 * Mic input uses the browser's built-in SpeechRecognition (Chrome/Edge) to turn speech into text.
 * Alongside it, a Web Audio AnalyserNode draws a live input-level meter and (optionally) feeds
 * `levelRef` so the orb can shimmer. The meter runs locally in your browser: nothing is recorded
 * or uploaded by this component. (Chrome's speech recognition itself uses the browser's speech service.)
 * Live call audio (Deepgram) is a separate component: LiveAudio.jsx.
 */
export default function MicCapture({ onChunk, speaker = "caller", levelRef = null, onListeningChange = null }) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState("");
  const [supported] = useState(Boolean(SpeechRecognitionImpl));
  const recognitionRef = useRef(null);
  const handlerRef = useRef({ onChunk, speaker });
  handlerRef.current = { onChunk, speaker };
  const meterRef = useRef(null);
  const audioRef = useRef({ stream: null, ctx: null, raf: 0 });
  const wantMeter = useRef(false); // false as soon as the user stops, even if getUserMedia is still pending

  function stopMeter() {
    wantMeter.current = false;
    const a = audioRef.current;
    cancelAnimationFrame(a.raf);
    a.raf = 0;
    a.stream?.getTracks().forEach((t) => t.stop());
    a.stream = null;
    if (a.ctx && a.ctx.state !== "closed") a.ctx.close().catch(() => {});
    a.ctx = null;
    if (levelRef) levelRef.current = 0;
    if (meterRef.current) meterRef.current.style.setProperty("--lvl", "0");
  }

  async function startMeter() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const a = audioRef.current;
      if (a.stream || !wantMeter.current || !recognitionRef.current) {
        stream.getTracks().forEach((t) => t.stop()); // stopped again before we got here
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === "suspended") ctx.resume().catch(() => {}); // autoplay policy safety net
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      a.stream = stream;
      a.ctx = ctx;
      const buf = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t) => {
        a.raf = requestAnimationFrame(tick);
        if (t - last < 40) return; // ~25 updates/s is plenty for a meter
        last = t;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = (buf[i] - 128) / 128;
          sum += d * d;
        }
        const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        if (levelRef) levelRef.current = lvl;
        meterRef.current?.style.setProperty("--lvl", lvl.toFixed(3));
      };
      a.raf = requestAnimationFrame(tick);
    } catch (err) {
      setNote(err?.name === "NotFoundError" ? tRef.current("mic.none") : tRef.current("mic.blocked"));
    }
  }

  // lets the 3D shield know when the operator is listening (reports "not listening" again on unmount)
  useEffect(() => {
    onListeningChange?.(listening);
    return () => onListeningChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  useEffect(() => {
    if (!SpeechRecognitionImpl) return undefined;
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true; // lets us score while the person is still talking
    recognition.lang = "en-IN";
    // Chrome only marks a phrase "final" about a second after the speaker pauses. To cut that wait we send
    // the words as soon as the interim text has been stable for a moment, and send only what is new when
    // the final version arrives (sent[i] = how many characters of phrase i were already sent).
    const sent = {};
    const timers = {};
    let queue = Promise.resolve(); // keeps lines in order even though requests overlap
    const push = (text) => {
      const t = text.trim();
      if (t) queue = queue.then(() => handlerRef.current.onChunk(t, handlerRef.current.speaker)).catch(() => {});
    };
    const flushNew = (i, text) => {
      const done = sent[i] || 0;
      if (text.length > done) {
        push(text.slice(done));
        sent[i] = text.length;
      }
    };
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        clearTimeout(timers[i]);
        if (result.isFinal) {
          flushNew(i, text);
          delete sent[i];
          delete timers[i];
        } else {
          timers[i] = setTimeout(() => flushNew(i, text), 450);
        }
      }
    };
    recognition.onerror = (e) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") setNote(tRef.current("mic.blocked"));
      setListening(false);
      stopMeter();
    };
    recognition.onend = () => {
      setListening(false);
      stopMeter();
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.stop();
      recognitionRef.current = null;
      stopMeter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    if (!recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
      stopMeter();
    } else {
      setNote("");
      recognitionRef.current.start(); // must run inside the click for browsers' user-activation rule
      setListening(true);
      wantMeter.current = true;
      startMeter();
    }
  }

  if (!supported) return <span className="badge-muted">{t("mic.needsChrome")}</span>;

  return (
    <span className="mic">
      <button type="button" onClick={toggle} className={`btn ${listening ? "btn-primary" : ""}`} aria-pressed={listening}>
        {listening ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
        {listening ? t("mic.listening") : t("mic.use")}
      </button>
      {listening && <span className="meter" ref={meterRef} role="img" aria-label={t("mic.level")}><i /></span>}
      {note && <span className="msg-error" role="alert">{note}</span>}
    </span>
  );
}
