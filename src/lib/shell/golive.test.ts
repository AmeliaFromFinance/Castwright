import { describe, expect, it } from 'vitest';
import type { Check } from '$lib/bindings/Check';
import { fixLabel, keepTicks, sortChecks, summaryText, tally, wentLive } from './golive';
import { alertSummary } from './alert-control';
import type { QueueState } from '$lib/bindings/QueueState';
import type { AlertPlay } from '$lib/bindings/AlertPlay';

const check = (id: string, status: Check['status']): Check => ({ id, label: id, status, detail: '', fix: null });

describe('go-live check', () => {
  it('puts problems first and keeps the order otherwise', () => {
    const list = [check('obs', 'pass'), check('a', 'warn'), check('b', 'fail'), check('c', 'pass'), check('d', 'fail')];
    expect(sortChecks(list).map((c) => c.id)).toEqual(['b', 'd', 'a', 'obs', 'c']);
    expect(list[0]!.id).toBe('obs');
  });

  it('sums up the results', () => {
    expect(summaryText(tally([check('a', 'pass')]))).toBe('All good');
    expect(summaryText(tally([check('a', 'fail'), check('b', 'warn'), check('c', 'warn')]))).toBe('1 problem, 2 warnings');
    expect(summaryText(tally([check('a', 'fail'), check('b', 'fail')]))).toBe('2 problems');
    expect(summaryText(tally([check('a', 'warn')]))).toBe('1 warning');
  });

  it('names every fix', () => {
    expect(fixLabel({ type: 'fix_overlay_link', input: 'x', overlay_id: 'y' })).toBe('Fix link');
    expect(fixLabel({ type: 'open', place: 'overlays' })).toBe('Open');
    expect(fixLabel({ type: 'resume_alerts' })).toBe('Resume');
  });

  it('only counts a real switch from offline to live', () => {
    expect(wentLive(null, true)).toBe(false);
    expect(wentLive(false, true)).toBe(true);
    expect(wentLive(true, true)).toBe(false);
    expect(wentLive(true, false)).toBe(false);
  });

  it('drops ticks for removed items', () => {
    expect([...keepTicks(new Set(['a', 'b', 'gone']), ['a', 'b', 'c'])]).toEqual(['a', 'b']);
  });
});

describe('alert control', () => {
  const play = { id: 'p', title: 'Nova followed' } as AlertPlay;
  const q = (patch: Partial<QueueState> = {}): QueueState => ({ paused: false, muted: false, playing: null, waiting: [], last: null, ...patch });

  it('shows the queue size and state', () => {
    expect(alertSummary(q())).toEqual({ label: 'Alerts', count: 0, tone: 'ok', title: 'Alerts, nothing queued' });
    expect(alertSummary(q({ playing: play, waiting: [play, play] }))).toMatchObject({ count: 3, title: 'Alerts, 3 alerts queued' });
    expect(alertSummary(q({ muted: true, waiting: [play] }))).toMatchObject({ label: 'Muted', tone: 'muted', title: 'Alerts muted, 1 alert queued' });
    expect(alertSummary(q({ paused: true, muted: true }))).toMatchObject({ label: 'Paused', tone: 'paused', title: 'Alerts paused and muted, nothing queued' });
  });
});
