import { describe, expect, it } from "vitest";
import { Downsampler, FrameChunker, FRAME_SAMPLES, floatToPcm16, pcm16ToFloat32, planFrame, rms } from "./pcm";

const sine = (hz, rate, n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const peak = (a, skip = 8) => Math.max(...Array.from(a.subarray(skip), Math.abs));

describe("Downsampler", () => {
  it("48 kHz -> 16 kHz gives a third of the samples and keeps a speech-band tone", () => {
    const out = new Downsampler(48000).push(sine(440, 48000, 4800));
    expect(out.length).toBe(1600);
    expect(peak(out)).toBeGreaterThan(0.48);
    expect(peak(out)).toBeLessThan(0.52);
  });

  it("44.1 kHz -> 16 kHz: the right number of samples over a long run, and no drift in the tone", () => {
    const ds = new Downsampler(44100);
    let total = 0;
    let last;
    for (let k = 0; k < 100; k++) {
      last = ds.push(sine(300, 44100, 441, 0.4));
      total += last.length;
    }
    expect(Math.abs(total - 16000)).toBeLessThanOrEqual(2);
  });

  it("passes DC through unchanged and is a pass-through at 16 kHz", () => {
    const dc = new Downsampler(48000).push(new Float32Array(960).fill(0.25));
    expect(Math.max(...dc)).toBeCloseTo(0.25, 5);
    expect(Math.min(...dc)).toBeCloseTo(0.25, 5);
    const x = sine(1000, 16000, 320);
    const same = new Downsampler(16000).push(x);
    expect(Array.from(same)).toEqual(Array.from(x));
  });

  it("does not depend on how the input is cut into chunks", () => {
    const x = sine(500, 44100, 4410);
    const whole = new Downsampler(44100).push(x);
    const ds = new Downsampler(44100);
    const parts = [];
    for (let i = 0; i < x.length; i += 137) parts.push(ds.push(x.subarray(i, i + 137)));
    const joined = Float32Array.from(parts.flatMap((p) => Array.from(p)));
    expect(joined.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(joined[i]).toBeCloseTo(whole[i], 5);
  });

  it("a tone far above the new Nyquist is attenuated, not passed at full strength", () => {
    const out = new Downsampler(48000).push(sine(20000, 48000, 4800, 0.5));
    expect(peak(out)).toBeLessThan(0.3);
  });
});

describe("PCM conversion", () => {
  it("round-trips within one 16-bit step and clamps out-of-range input", () => {
    const x = Float32Array.from([0, 0.5, -0.5, 1, -1, 0.123456]);
    const back = pcm16ToFloat32(floatToPcm16(x));
    x.forEach((v, i) => expect(Math.abs(back[i] - v)).toBeLessThan(1 / 16384));
    const clipped = floatToPcm16(Float32Array.from([2, -2]));
    expect(Array.from(clipped)).toEqual([32767, -32768]);
  });

  it("rms of silence is 0 and of a full-scale sine is about 0.707", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(sine(100, 16000, 16000, 1))).toBeCloseTo(0.7071, 2);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe("FrameChunker", () => {
  it("emits whole 20 ms frames, keeps the remainder, and loses nothing", () => {
    const c = new FrameChunker();
    const frames = [];
    for (let i = 0; i < 7; i++) frames.push(...c.push(new Float32Array(100).fill(0.1)));
    expect(frames.length).toBe(2); // 700 samples = 2 x 320 + 60 waiting
    expect(frames.every((f) => f.length === FRAME_SAMPLES && f.byteLength === FRAME_SAMPLES * 2)).toBe(true);
    frames.push(...c.push(new Float32Array(260)));
    expect(frames.length).toBe(3);
  });
});

describe("planFrame", () => {
  const d = 0.02;
  it("waits a short moment before the first frame and then plays frames back to back", () => {
    const a = planFrame({ now: 10, nextTime: 0, duration: d });
    expect(a.drop).toBe(false);
    expect(a.startAt).toBeCloseTo(10.12, 5);
    const b = planFrame({ now: 10.01, nextTime: a.nextTime, duration: d });
    expect(b.startAt).toBeCloseTo(a.nextTime, 5);
  });
  it("starts over with a small cushion after an underrun", () => {
    const r = planFrame({ now: 20, nextTime: 19.5, duration: d });
    expect(r.startAt).toBeCloseTo(20.12, 5);
  });
  it("drops frames that would play more than 0.6 s late (catching up after a stall)", () => {
    const r = planFrame({ now: 30, nextTime: 30.9, duration: d });
    expect(r.drop).toBe(true);
    expect(r.nextTime).toBe(30.9);
  });
});
