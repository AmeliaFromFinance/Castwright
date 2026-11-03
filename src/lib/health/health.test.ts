import { describe, expect, it } from 'vitest';
import type { HealthIssue } from '$lib/bindings/HealthIssue';
import type { HealthSnapshot } from '$lib/bindings/HealthSnapshot';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { ProviderStatus } from '$lib/overlay/emotes/loader';
import { emoteIssues, filterProblems, issueUrl, pagesText, problemLine, sources, summarize, tooltip, untilText, worst } from './health';

function snap(issues: HealthIssue[] = []): HealthSnapshot {
  return { issues, level: worst(issues.map((i) => i.level)) } as HealthSnapshot;
}

const warn = (text: string): HealthIssue => ({ level: 'warn', area: 'obs', text });
const bad = (text: string): HealthIssue => ({ level: 'bad', area: 'overlays', text });
const provider = (name: string, state: ProviderStatus['state']): ProviderStatus => ({
  provider: '7tv',
  name,
  state,
  emotes: 0,
  error: state === 'error' ? '500' : null,
  loadedAt: null
});

describe('health summary', () => {
  it('picks the worst level', () => {
    expect(worst([])).toBe('ok');
    expect(worst(['ok', 'warn', 'ok'])).toBe('warn');
    expect(worst(['warn', 'bad', 'ok'])).toBe('bad');
  });

  it('says all good, or counts problems and warnings', () => {
    expect(summarize(null)).toEqual({ level: 'ok', text: 'Checking…', issues: [] });
    expect(summarize(snap())).toMatchObject({ level: 'ok', text: 'All good' });
    expect(summarize(snap([warn('a')])).text).toBe('1 warning');
    const s = summarize(snap([warn('a'), bad('b'), warn('c'), bad('d')]));
    expect(s.level).toBe('bad');
    expect(s.text).toBe('2 problems, 2 warnings');
    expect(s.issues.map((i) => i.text)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('adds emote providers the window knows about', () => {
    const providers = [provider('7TV', 'ok'), provider('BetterTTV', 'error'), provider('FrankerFaceZ', 'loading')];
    expect(emoteIssues(providers)).toEqual([{ level: 'warn', area: 'twitch', text: "BetterTTV emotes aren't loading." }]);
    const s = summarize(snap(), providers);
    expect(s.level).toBe('warn');
    expect(s.text).toBe('1 warning');
  });

  it('builds a short tooltip', () => {
    expect(tooltip(summarize(snap()))).toBe('Health: All good');
    const many = summarize(snap(['a', 'b', 'c', 'd', 'e', 'f'].map(warn)));
    expect(tooltip(many, 4).split('\n')).toEqual(['Health: 6 warnings', '• a', '• b', '• c', '• d', '• and 2 more']);
  });
});

describe('recent problems', () => {
  const log: LogEntry[] = [
    { ts: Date.UTC(2026, 10, 3, 9, 30), level: 'error', source: 'twitch', message: 'Lost connection' },
    { ts: Date.UTC(2026, 10, 3, 9, 20), level: 'warn', source: 'automation', message: 'Paused' },
    { ts: Date.UTC(2026, 10, 3, 9, 10), level: 'warn', source: 'twitch', message: 'Retrying' }
  ];

  it('lists and filters by source', () => {
    expect(sources(log)).toEqual(['automation', 'twitch']);
    expect(filterProblems(log, 'twitch').map((p) => p.message)).toEqual(['Lost connection', 'Retrying']);
    expect(filterProblems(log, null)).toHaveLength(3);
  });

  it('copies as one line', () => {
    expect(problemLine(log[0]!)).toBe('2026-11-03T09:30:00.000Z ERROR [twitch] Lost connection');
  });
});

describe('details', () => {
  it('groups open pages by browser', () => {
    expect(pagesText([])).toBe('Not open');
    expect(pagesText([{ agent: 'OBS 32', since: 1 }])).toBe('OBS 32');
    expect(pagesText([{ agent: 'OBS 32', since: 1 }, { agent: 'Chrome', since: 2 }, { agent: 'OBS 32', since: 3 }])).toBe('OBS 32 ×2, Chrome');
  });

  it('says when a sign-in runs out', () => {
    const now = 1_000_000_000;
    expect(untilText(now - 1, now)).toBe('expired');
    expect(untilText(now + 45 * 60_000, now)).toBe('in 45 min');
    expect(untilText(now + 3 * 3_600_000, now)).toBe('in 3 h');
    expect(untilText(now + 3 * 3_600_000 + 20 * 60_000 + 5000, now)).toBe('in 3 h 20 min');
  });

  it('prefills the issue title with the version', () => {
    const url = new URL(issueUrl('0.6.0'));
    expect(url.pathname).toBe('/AmeliaFromFinance/castwright/issues/new');
    expect(url.searchParams.get('title')).toBe('[v0.6.0] ');
    expect(url.searchParams.get('body')).toContain('.zip');
  });
});
