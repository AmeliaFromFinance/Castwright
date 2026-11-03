import { describe, expect, it } from 'vitest';
import { IDLE, bytesText, percent, progressText, step, type UpdateEvent, type UpdatePhase } from './update-flow';
import { nextVersion } from '$lib/api/mock-updates';

const run = (events: UpdateEvent[], from: UpdatePhase = IDLE) => events.reduce(step, from);

describe('update progress text', () => {
  it('formats sizes', () => {
    expect(bytesText(850)).toBe('850 B');
    expect(bytesText(20_480)).toBe('20 KB');
    expect(bytesText(48_234_496)).toBe('46.0 MB');
  });

  it('works out the percentage', () => {
    expect(percent(0, 100)).toBe(0);
    expect(percent(27, 100)).toBe(27);
    expect(percent(999, 1000)).toBe(99);
    expect(percent(150, 100)).toBe(100);
    expect(percent(10, null)).toBeNull();
    expect(percent(10, 0)).toBeNull();
  });

  it('shows bytes and percent, or bytes alone', () => {
    expect(progressText(12_897_484, 47_815_065)).toBe('12.3 MB of 45.6 MB · 26%');
    expect(progressText(12_897_484, null)).toBe('12.3 MB');
  });
});

describe('update steps', () => {
  const found: UpdateEvent = { type: 'found', canInstall: true, reason: null };

  it('downloads, then offers a restart', () => {
    let s = run([found, { type: 'download' }]);
    expect(s).toEqual({ kind: 'downloading', downloaded: 0, total: null });
    s = run([{ type: 'progress', downloaded: 500, total: 1000 }, { type: 'progress', downloaded: 300, total: null }], s);
    expect(s).toEqual({ kind: 'downloading', downloaded: 500, total: 1000 });
    s = step(s, { type: 'downloaded' });
    expect(s).toEqual({ kind: 'ready' });
    expect(step(s, { type: 'restart', outcome: 'restarting' })).toEqual({ kind: 'restarting' });
  });

  it('waits for the stream to end, then asks again', () => {
    let s = run([found, { type: 'download' }, { type: 'downloaded' }, { type: 'restart', outcome: 'after_stream' }]);
    expect(s.kind).toBe('waiting');
    s = step(s, { type: 'stream_ended' });
    expect(s.kind).toBe('ask');
    expect(step(s, { type: 'cancel' }).kind).toBe('ready');
    expect(step(s, { type: 'restart', outcome: 'restarting' }).kind).toBe('restarting');
    expect(step({ kind: 'ready' }, { type: 'stream_ended' }).kind).toBe('ready');
  });

  it('only offers GitHub when this copy cannot update itself', () => {
    const s = run([{ type: 'found', canInstall: false, reason: 'Portable package install.' }, { type: 'download' }]);
    expect(s).toEqual({ kind: 'available', canInstall: false, reason: 'Portable package install.' });
  });

  it('shows errors and lets you try again', () => {
    let s = run([found, { type: 'download' }, { type: 'failed', message: 'Bad signature' }]);
    expect(s).toEqual({ kind: 'error', message: 'Bad signature' });
    s = step(s, { type: 'download' });
    expect(s.kind).toBe('downloading');
  });

  it("a later check doesn't interrupt a download", () => {
    const s = run([found, { type: 'download' }, found]);
    expect(s.kind).toBe('downloading');
    expect(run([found, { type: 'download' }, { type: 'downloaded' }, found]).kind).toBe('ready');
    expect(step(s, { type: 'reset' })).toEqual(IDLE);
  });

  it('ignores events that make no sense yet', () => {
    expect(step(IDLE, { type: 'downloaded' })).toEqual(IDLE);
    expect(step(IDLE, { type: 'restart', outcome: 'restarting' })).toEqual(IDLE);
    expect(step(IDLE, { type: 'progress', downloaded: 5, total: 10 })).toEqual(IDLE);
  });
});

describe('demo update', () => {
  it('is the next minor version', () => {
    expect(nextVersion('0.7.0')).toBe('0.8.0');
    expect(nextVersion('v1.9.3')).toBe('1.10.0');
  });
});
