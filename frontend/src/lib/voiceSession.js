// One in-app voice call from this browser's side: microphone + speaker + the /ws/voice socket.
// The React screen (pages/CallRoom.jsx) owns the UI; this class owns everything that must be torn down together.
import { WS_BASE } from "../ws";
import { makeAudioContext, openMic, startCapture, VoicePlayer } from "./voiceAudio";

export class VoiceSession {
  /**
   * @param {{code: string, role: "host"|"guest", onEvent: (e: object) => void}} opts
   * Events are the server's JSON messages as-is, plus {type:"closed", clean:boolean} when the socket ends.
   * localLevel / remoteLevel (0..1) are plain fields the screen can read every animation frame.
   */
  constructor({ code, role, onEvent }) {
    this.code = code;
    this.role = role;
    this.onEvent = onEvent;
    this.localLevel = 0;
    this.remoteLevel = 0;
    this.muted = false;
    this.live = false; // only send audio while the call is live (the server drops it otherwise)
    this.stopped = false;
  }

  /** Must be called from a click: the audio context needs a user gesture. Throws if the microphone is unavailable. */
  async start() {
    this.ctx = makeAudioContext();
    await this.ctx.resume().catch(() => {});
    try {
      this.stream = await openMic();
    } catch (err) {
      this.stop();
      throw err;
    }
    this.player = new VoicePlayer(this.ctx, (l) => { this.remoteLevel = l; });

    const ws = new WebSocket(`${WS_BASE}/ws/voice/${encodeURIComponent(this.code)}?role=${this.role}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") { this.player?.push(e.data); return; }
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.handle(m);
      this.onEvent(m);
    };
    ws.onclose = (e) => { this.live = false; if (!this.stopped) this.onEvent({ type: "closed", clean: e.code === 1000 || e.code === 1005 }); this.teardown(); };
    ws.onerror = () => { /* onclose follows and reports it */ };
  }

  handle(m) {
    if (m.type === "joined") {
      this.send({ type: "ack_notice" }); // the person accepted the notice on screen before this socket was opened
      this.capture = startCapture(
        this.ctx,
        this.stream,
        (frame) => { if (this.live && this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame); },
        (l) => { this.localLevel = this.muted ? 0 : l; },
      );
      this.capture.catch?.(() => this.onEvent({ type: "error", code: "audio_failed", message: "Could not start the microphone pipeline." }));
    } else if (m.type === "live") this.live = true;
    else if (m.type === "peer" && m.state === "left") this.live = false;
    else if (m.type === "ended") this.live = false;
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  setMuted(muted) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    if (muted) this.localLevel = 0;
    this.send({ type: "mute", muted });
  }

  hangup() {
    this.send({ type: "hangup" });
    this.stop();
  }

  stop() {
    this.stopped = true;
    this.live = false;
    const ws = this.ws;
    if (ws && ws.readyState <= WebSocket.OPEN) setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 300); // let "hangup" go out first
    this.teardown();
  }

  teardown() {
    Promise.resolve(this.capture).then((c) => c?.stop?.()).catch(() => {});
    this.capture = null;
    this.player?.stop();
    this.player = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx && this.ctx.state !== "closed") this.ctx.close().catch(() => {});
    this.localLevel = 0;
    this.remoteLevel = 0;
  }
}
