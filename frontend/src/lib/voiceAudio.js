// Browser audio plumbing for in-app voice calls: microphone -> 20 ms PCM frames, and incoming frames -> speaker.
// The maths lives in pcm.js (unit tested); this file only wires it to Web Audio, which needs a real browser.
import { Downsampler, FrameChunker, TARGET_RATE, pcm16ToFloat32, planFrame, rms } from "./pcm";

// Runs on the audio thread: gathers the microphone into ~20 ms blocks and posts them to the page.
const WORKLET_SRC = `
class AwaazCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.02);
    this.buf = new Float32Array(this.size);
    this.len = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const take = Math.min(this.size - this.len, ch.length - i);
      this.buf.set(ch.subarray(i, i + take), this.len);
      this.len += take;
      i += take;
      if (this.len === this.size) {
        this.port.postMessage(this.buf.slice(0));
        this.len = 0;
      }
    }
    return true;
  }
}
registerProcessor("awaaz-capture", AwaazCapture);
`;

export const voiceSupported = () =>
  Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext) && window.WebSocket);

/** Echo cancellation, noise suppression and gain control are ON here (a real conversation, unlike the cable-fed live audio panel). */
export function openMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
}

/** Prefer a 16 kHz context so the browser resamples with its own high-quality filter; otherwise use the default rate and convert ourselves. */
export function makeAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  try {
    const ctx = new Ctx({ sampleRate: TARGET_RATE });
    if (ctx.sampleRate === TARGET_RATE) return ctx;
    ctx.close().catch(() => {});
  } catch { /* this browser cannot pick a rate */ }
  return new Ctx();
}

/**
 * Starts sending 20 ms PCM frames. onFrame(ArrayBuffer) gets each frame; onLevel(0..1) the loudness of each block.
 * Returns { stop() }. Muting is done on the stream's tracks by the caller (the frames then carry silence).
 */
export async function startCapture(ctx, stream, onFrame, onLevel) {
  const source = ctx.createMediaStreamSource(stream);
  const sink = ctx.createGain(); // processing nodes must reach the destination to run, but we do not want to hear ourselves
  sink.gain.value = 0;
  sink.connect(ctx.destination);
  const down = new Downsampler(ctx.sampleRate);
  const chunker = new FrameChunker();
  const handle = (f32) => {
    onLevel?.(Math.min(1, rms(f32) * 4));
    for (const frame of chunker.push(down.push(f32))) onFrame(frame.buffer);
  };

  let node;
  let url;
  try {
    url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, "awaaz-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (e) => handle(e.data);
  } catch {
    // older browsers: the deprecated ScriptProcessor still works
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
  source.connect(node);
  node.connect(sink);

  return {
    stop() {
      try { source.disconnect(); node.disconnect(); sink.disconnect(); } catch { /* already disconnected */ }
      if (node.port) node.port.onmessage = null;
      if (node.onaudioprocess) node.onaudioprocess = null;
    },
  };
}

/** Plays the other person's 16 kHz PCM frames, scheduled so the sound is continuous (see planFrame). */
export class VoicePlayer {
  constructor(ctx, onLevel) {
    this.ctx = ctx;
    this.onLevel = onLevel;
    this.nextTime = 0;
    this.sources = new Set();
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
  }

  push(arrayBuffer) {
    if (arrayBuffer.byteLength < 2) return;
    const f32 = pcm16ToFloat32(new Int16Array(arrayBuffer, 0, arrayBuffer.byteLength >> 1));
    this.onLevel?.(Math.min(1, rms(f32) * 4));
    const plan = planFrame({ now: this.ctx.currentTime, nextTime: this.nextTime, duration: f32.length / TARGET_RATE });
    if (plan.drop) return;
    const buf = this.ctx.createBuffer(1, f32.length, TARGET_RATE);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    src.onended = () => this.sources.delete(src);
    this.sources.add(src);
    src.start(plan.startAt);
    this.nextTime = plan.nextTime;
  }

  stop() {
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources.clear();
    try { this.out.disconnect(); } catch { /* already gone */ }
  }
}
