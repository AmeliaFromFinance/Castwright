// Short sounds made in code, for the browser demo. Each is an 8-bit mono WAV in a data URL.

const RATE = 16_000;

type Sample = (t: number, i: number) => number;

/** WAV bytes for `seconds` of `fn` (values -1 to 1). */
export function wav(seconds: number, fn: Sample): Uint8Array {
  const n = Math.max(1, Math.round(seconds * RATE));
  const out = new Uint8Array(44 + n);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => out.set([c.charCodeAt(0)], at + i));
  text(0, 'RIFF');
  view.setUint32(4, 36 + n, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, fn(i / RATE, i)));
    out[44 + i] = Math.round(128 + v * 127);
  }
  return out;
}

export function dataUrl(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

const TAU = Math.PI * 2;
const saw = (f: number, t: number) => 2 * ((f * t) % 1) - 1;
const sine = (f: number, t: number) => Math.sin(TAU * f * t);
/** Fade in and out over `edge` seconds. */
const env = (t: number, len: number, edge = 0.02) => Math.min(1, t / edge, (len - t) / edge);

/** Repeatable noise, so the demo sounds the same each time. */
function noise(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (s / 1_073_741_824) - 1;
  };
}

export const TONES = {
  airhorn: () => wav(1.1, (t) => 0.45 * env(t, 1.1) * (saw(415, t) + saw(523, t) * 0.7 + saw(622, t) * 0.5) * (t % 0.37 < 0.33 ? 1 : 0.2)),
  drumroll: () => {
    const r = noise(3);
    return wav(1.6, (t) => {
      const hit = t % 0.06;
      const swell = 0.35 + 0.65 * (t / 1.6);
      return r() * Math.exp(-hit * 60) * swell * env(t, 1.6) + (t > 1.45 ? sine(70, t) * Math.exp(-(t - 1.45) * 12) : 0);
    });
  },
  trombone: () => {
    const notes = [392, 370, 349, 330];
    return wav(2.2, (t) => {
      const k = Math.min(3, Math.floor(t / 0.45));
      const f = notes[k]! * (k === 3 ? 1 + 0.02 * Math.sin(TAU * 6 * t) : 1);
      return 0.5 * env(t, 2.2, 0.04) * (saw(f, t) * 0.6 + sine(f, t) * 0.4) * (k < 3 && t % 0.45 > 0.42 ? 0.2 : 1);
    });
  },
  ding: () => wav(1.2, (t) => 0.6 * Math.exp(-t * 4) * (sine(1318, t) + 0.4 * sine(2637, t)) * env(t, 1.2, 0.005)),
  applause: () => {
    const r = noise(11);
    return wav(2.4, (t) => {
      const clap = (t * 23.3) % 1;
      return r() * (0.25 + 0.5 * Math.exp(-clap * 8)) * env(t, 2.4, 0.3);
    });
  },
  laser: () => wav(0.7, (t) => 0.5 * env(t, 0.7) * Math.sign(sine(1800 * Math.exp(-t * 4), t)))
} satisfies Record<string, () => Uint8Array>;

export type ToneName = keyof typeof TONES;
