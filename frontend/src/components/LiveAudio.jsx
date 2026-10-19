import { useEffect, useRef, useState } from "react";
import { AudioLines, Square } from "lucide-react";
import { WS_BASE } from "../ws";
import { micLevel } from "../lib/micLevel";
import { useT } from "../i18n";

/**
 * Live call audio -> Deepgram (through the backend, which holds the key).
 * Sources: a chosen audio input (a mic, or a virtual cable such as BlackHole / VB-Cable that carries a
 * WhatsApp call) or the audio of a browser tab. Audio is recorded in 250 ms pieces and streamed over
 * /ws/stt/{callId}; finished phrases are scored by the backend like any other line, and the words still
 * being spoken are shown here as a preview. Nothing is stored locally.
 */
const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
export const liveAudioSupported = Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);

export default function LiveAudio({ callId, speaker, available, onChanged, onListeningChange }) {
  const t = useT();
  const [source, setSource] = useState("device"); // "device" | "tab"
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [state, setState] = useState("idle"); // idle | connecting | live
  const [interim, setInterim] = useState("");
  const [note, setNote] = useState("");
  const [twoVoices, setTwoVoices] = useState(false); // speakerphone: one audio stream with both people in it
  const [swapped, setSwapped] = useState(false);
  const [lang, setLang] = useState(""); // "" = the server default (English + Hindi); or "en-IN" / "hi"
  const run = useRef(null);
  const meterRef = useRef(null);

  const refreshDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch { /* the list just stays as it was */ }
  };
  useEffect(() => { refreshDevices(); }, []);
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onListeningChange?.(state === "live"); return () => onListeningChange?.(false); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  function teardown() {
    const r = run.current;
    run.current = null;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    try { if (r.recorder.state !== "inactive") r.recorder.stop(); } catch { /* already stopped */ }
    r.stream.getTracks().forEach((tr) => tr.stop());
    if (r.ctx.state !== "closed") r.ctx.close().catch(() => {});
    micLevel.current = 0;
    meterRef.current?.style.setProperty("--lvl", "0");
  }

  async function getStream() {
    if (source === "tab") {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      display.getVideoTracks().forEach((tr) => tr.stop());
      if (!display.getAudioTracks().length) {
        display.getTracks().forEach((tr) => tr.stop());
        throw Object.assign(new Error("no-audio"), { code: "no-tab-audio" });
      }
      return new MediaStream(display.getAudioTracks());
    }
    // A virtual cable carries clean digital audio, so processing would only mangle it. A real microphone (a laptop
    // hearing a speakerphone, say) is noisy and quiet, so noise suppression and automatic gain help the transcript.
    // Echo cancellation stays off either way: it would also cancel the far voice coming out of the speaker.
    const label = devices.find((d) => d.deviceId === deviceId)?.label || "";
    const clean = /blackhole|cable|virtual|loopback|vb-audio|soundflower|aggregate|multi-output/i.test(label);
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: !clean, autoGainControl: !clean },
    });
  }

  async function start() {
    setNote("");
    setInterim("");
    setSwapped(false);
    setState("connecting");
    let stream;
    try {
      stream = await getStream();
    } catch (err) {
      setState("idle");
      setNote(err?.code === "no-tab-audio" ? t("live.noTabAudio") : err?.name === "NotAllowedError" ? t("live.denied") : t("live.noDevice"));
      return;
    }
    refreshDevices(); // device names are only readable after permission was granted

    const ws = new WebSocket(`${WS_BASE}/ws/stt/${callId}?speaker=${speaker === "agent" ? "agent" : "caller"}${twoVoices ? "&diarize=1" : ""}${lang ? `&lang=${lang}` : ""}`);
    ws.binaryType = "arraybuffer";
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
    const r = { ws, stream, ctx, recorder, raf: 0 };
    run.current = r;

    const tick = () => {
      r.raf = requestAnimationFrame(tick);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
      micLevel.current = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      meterRef.current?.style.setProperty("--lvl", micLevel.current.toFixed(3));
    };
    r.raf = requestAnimationFrame(tick);

    recorder.ondataavailable = (e) => { if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(e.data); };
    stream.getAudioTracks()[0]?.addEventListener("ended", () => stop()); // e.g. the shared tab was closed

    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "ready") { recorder.start(250); setState("live"); }
      else if (m.type === "interim") setInterim(m.text);
      else if (m.type === "transcript") { setInterim(""); onChanged?.(); }
      else if (m.type === "roles") setSwapped(Boolean(m.swapped));
      else if (m.type === "error") {
        setNote(m.code === "not_configured" ? t("live.noKey") : m.code === "upstream_unreachable" ? t("live.unreachable") : m.message || t("live.failed"));
        teardown();
        setState("idle");
      }
    };
    ws.onclose = () => { if (run.current === r) { teardown(); setState("idle"); } setInterim(""); };
    ws.onerror = () => { setNote(t("live.failed")); };
  }

  function stop() {
    const r = run.current;
    if (!r) return;
    try { if (r.recorder.state !== "inactive") r.recorder.stop(); } catch { /* ignore */ }
    try { r.ws.send("stop"); } catch { /* socket already closed */ }
    setState("idle"); // the socket closes itself once the last phrase has been returned
    setTimeout(() => { if (run.current === r) teardown(); try { r.ws.close(); } catch { /* ignore */ } }, 3500);
  }

  if (!liveAudioSupported) return null;
  if (!available) return <p className="live-hint">{t("live.needsKey")}</p>;
  const busy = state !== "idle";

  return (
    <div className="live-audio">
      <div className="live-row">
        <label className="live-label"><AudioLines size={14} aria-hidden="true" />{t("live.title")}</label>
        <select value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} aria-label={t("live.source")}>
          <option value="device">{t("live.srcDevice")}</option>
          <option value="tab">{t("live.srcTab")}</option>
        </select>
        {source === "device" && (
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} onFocus={refreshDevices} disabled={busy} aria-label={t("live.device")}>
            <option value="">{t("live.defaultDevice")}</option>
            {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t("live.input")} ${i + 1}`}</option>)}
          </select>
        )}
        {state === "idle" ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={start}>{t("live.start")}</button>
        ) : (
          <button type="button" className="btn btn-sm btn-danger" onClick={stop} aria-busy={state === "connecting"}>
            <Square size={12} aria-hidden="true" />{state === "connecting" ? t("live.connecting") : t("live.stop")}
          </button>
        )}
        <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy} aria-label={t("live.lang")}>
          <option value="">{t("live.langAuto")}</option>
          <option value="en-IN">{t("live.langEn")}</option>
          <option value="hi">{t("live.langHi")}</option>
        </select>
        <label className="live-check">
          <input type="checkbox" checked={twoVoices} onChange={(e) => setTwoVoices(e.target.checked)} disabled={busy} />
          {t("live.twoVoices")}
        </label>
        {state === "live" && twoVoices && (
          <button type="button" className="btn btn-sm" onClick={() => { try { run.current?.ws.send("swap"); } catch { /* socket closed */ } }} aria-pressed={swapped}>
            {t("live.swap")}
          </button>
        )}
        {state === "live" && <span className="meter" ref={meterRef} role="img" aria-label={t("mic.level")}><i /></span>}
      </div>
      {twoVoices && <p className="live-hint">{t("live.twoVoicesHint")}</p>}
      {interim && <p className="live-interim" aria-live="off">{interim}</p>}
      {note && <p className="msg-error" role="alert">{note}</p>}
    </div>
  );
}
