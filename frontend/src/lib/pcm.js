// Pure audio helpers for in-app voice calls (no browser APIs, so they are unit tested).
// Wire format between the browser and the backend: 16-bit signed little-endian mono PCM at 16 kHz, 20 ms per frame.

export const TARGET_RATE = 16000;
export const FRAME_SAMPLES = 320; // 20 ms at 16 kHz

/**
 * Streaming sample-rate converter. Every output sample is the AREA-WEIGHTED AVERAGE of the input it covers
 * (a box filter): a cheap low-pass that keeps most of the aliasing out of speech, and it handles fractional
 * ratios such as 44.1 kHz -> 16 kHz without drifting. State is kept between push() calls, so the result does
 * not depend on how the input was cut into chunks.
 * (When the browser can run the audio context at 16 kHz itself this is a pass-through and the browser's own
 * higher-quality resampler does the work.)
 */
export class Downsampler {
  constructor(inRate, outRate = TARGET_RATE) {
    this.ratio = inRate / outRate; // input samples per output sample
    this.sum = 0; // weighted sum for the output sample being built
    this.filled = 0; // how much of that output sample's width has been covered so far
  }

  push(input) {
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 2);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      let left = 1; // part of this input sample not yet assigned to an output sample
      while (left > 1e-9) {
        const need = this.ratio - this.filled;
        if (left >= need - 1e-9) {
          this.sum += x * need;
          out[n++] = this.sum / this.ratio;
          this.sum = 0;
          this.filled = 0;
          left -= need;
        } else {
          this.sum += x * left;
          this.filled += left;
          left = 0;
        }
      }
    }
    return out.subarray(0, n);
  }
}

export function floatToPcm16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

export function pcm16ToFloat32(i16) {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / (i16[i] < 0 ? 32768 : 32767);
  return out;
}

export function rms(f32) {
  if (!f32.length) return 0;
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}

/** Collects 16 kHz float samples and hands back whole 20 ms frames as Int16Array. */
export class FrameChunker {
  constructor(frameSamples = FRAME_SAMPLES) {
    this.n = frameSamples;
    this.buf = new Float32Array(frameSamples);
    this.len = 0;
  }

  push(f32) {
    const frames = [];
    let i = 0;
    while (i < f32.length) {
      const take = Math.min(this.n - this.len, f32.length - i);
      this.buf.set(f32.subarray(i, i + take), this.len);
      this.len += take;
      i += take;
      if (this.len === this.n) {
        frames.push(floatToPcm16(this.buf));
        this.len = 0;
      }
    }
    return frames;
  }
}

/**
 * Decides when to play the next incoming frame so the call sounds continuous.
 *  - first frame, or after a gap (underrun): wait a short moment (targetLatency) so a few frames can queue up
 *  - frames arrive in time: play them back to back
 *  - a burst after a network stall would push playback far behind real time: skip those frames to catch up
 */
export function planFrame({ now, nextTime, duration, targetLatency = 0.12, maxLatency = 0.6 }) {
  let startAt = nextTime;
  if (nextTime < now + 0.005) startAt = now + targetLatency;
  else if (nextTime - now > maxLatency) return { drop: true, startAt: nextTime, nextTime };
  return { drop: false, startAt, nextTime: startAt + duration };
}
