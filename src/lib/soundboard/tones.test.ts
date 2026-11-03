import { describe, expect, it } from 'vitest';
import { dataUrl, TONES, wav } from './tones';

describe('demo tones', () => {
  it('writes a valid 8-bit WAV', () => {
    const w = wav(0.5, (t) => Math.sin(t * 2000));
    const view = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8_000);
    expect(w.length).toBe(44 + 8_000);
  });

  it('makes every tone as a data URL', () => {
    for (const make of Object.values(TONES)) {
      const url = dataUrl(make());
      expect(url).toMatch(/^data:audio\/wav;base64,UklGR/);
      expect(url.length).toBeLessThan(80_000);
    }
  });
});
