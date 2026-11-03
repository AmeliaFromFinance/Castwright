import { describe, expect, it } from 'vitest';
import { formatTime, npVisible, progressAt, progressFraction, SAMPLE_TRACK, trackFromVars, trackKey } from './music';
import { resolveAsset } from './assets';

describe('progress', () => {
  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5_400)).toBe('0:05');
    expect(formatTime(187_999)).toBe('3:07');
    expect(formatTime(3_729_000)).toBe('1:02:09');
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });

  it('counts on while playing, up to the end', () => {
    const t = { playing: true, progressMs: 10_000, durationMs: 12_000 };
    expect(progressAt(t, 1000, 2500)).toBe(11_500);
    expect(progressAt(t, 1000, 9000)).toBe(12_000);
    expect(progressAt({ ...t, playing: false }, 1000, 9000)).toBe(10_000);
    expect(progressAt({ ...t, durationMs: 0 }, 1000, 9000)).toBe(18_000);
  });

  it('gives a fraction', () => {
    expect(progressFraction(50, 200)).toBe(0.25);
    expect(progressFraction(500, 200)).toBe(1);
    expect(progressFraction(50, 0)).toBe(0);
  });
});

describe('songs from variables', () => {
  it('reads the music variables', () => {
    const t = trackFromVars({
      'music.title': 'Nightcall',
      'music.artist': 'Kavinsky',
      'music.album': 'OutRun',
      'music.art_url': 'https://i.scdn.co/image/x',
      'music.playing': true,
      'music.progress_ms': 1000,
      'music.duration_ms': 2000
    });
    expect(t).toEqual({ title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', artUrl: 'https://i.scdn.co/image/x', playing: true, progressMs: 1000, durationMs: 2000 });
    expect(trackFromVars({ 'music.title': '  ' })).toBeNull();
    expect(trackFromVars({})).toBeNull();
    expect(trackKey(t)).not.toBe(trackKey(SAMPLE_TRACK));
  });

  it('hides some seconds after a pause when asked', () => {
    const paused = { ...SAMPLE_TRACK, playing: false };
    expect(npVisible(SAMPLE_TRACK, true, null, 5, 0)).toBe(true);
    expect(npVisible(paused, true, 1000, 5, 5999)).toBe(true);
    expect(npVisible(paused, true, 1000, 5, 6000)).toBe(false);
    expect(npVisible(paused, false, 1000, 5, 60_000)).toBe(true);
    expect(npVisible(null, false, null, 5, 0)).toBe(false);
  });

  it('serves local covers from the overlay server', () => {
    expect(resolveAsset('/music/art/3', 'http://127.0.0.1:7470', 'tok', 'key')).toBe('http://127.0.0.1:7470/music/art/3?key=key');
    expect(resolveAsset('https://i.scdn.co/image/x', 'http://127.0.0.1:7470', 'tok')).toBe('https://i.scdn.co/image/x');
  });
});
