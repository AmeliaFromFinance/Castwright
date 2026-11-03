import type { HealthIssue } from '$lib/bindings/HealthIssue';
import type { HealthLevel } from '$lib/bindings/HealthLevel';
import type { HealthSnapshot } from '$lib/bindings/HealthSnapshot';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { PageConnection } from '$lib/bindings/PageConnection';
import type { ProviderStatus } from '$lib/overlay/emotes/loader';

export const REPO = 'https://github.com/AmeliaFromFinance/castwright';

const RANK: Record<HealthLevel, number> = { ok: 0, warn: 1, bad: 2 };

export function worst(levels: Iterable<HealthLevel>): HealthLevel {
  let out: HealthLevel = 'ok';
  for (const l of levels) if (RANK[l] > RANK[out]) out = l;
  return out;
}

/** Emote providers only the app window knows about. */
export function emoteIssues(providers: readonly ProviderStatus[]): HealthIssue[] {
  return providers
    .filter((p) => p.state === 'error')
    .map((p) => ({ level: 'warn', area: 'twitch', text: `${p.name} emotes aren't loading.` }));
}

export interface HealthSummary {
  level: HealthLevel;
  /** "All good", "1 problem, 2 warnings" and so on. */
  text: string;
  /** Worst first. */
  issues: HealthIssue[];
}

export function summarize(s: HealthSnapshot | null, providers: readonly ProviderStatus[] = []): HealthSummary {
  if (!s) return { level: 'ok', text: 'Checking…', issues: [] };
  const issues = [...s.issues, ...emoteIssues(providers)].sort((a, b) => RANK[b.level] - RANK[a.level]);
  const bad = issues.filter((i) => i.level === 'bad').length;
  const warn = issues.filter((i) => i.level === 'warn').length;
  const parts: string[] = [];
  if (bad) parts.push(bad === 1 ? '1 problem' : `${bad} problems`);
  if (warn) parts.push(warn === 1 ? '1 warning' : `${warn} warnings`);
  return { level: worst(issues.map((i) => i.level)), text: parts.join(', ') || 'All good', issues };
}

/** Status bar tooltip: the summary, then up to `max` issues. */
export function tooltip(sum: HealthSummary, max = 4): string {
  const lines = [`Health: ${sum.text}`, ...sum.issues.slice(0, max).map((i) => `• ${i.text}`)];
  const more = sum.issues.length - max;
  if (more > 0) lines.push(`• and ${more} more`);
  return lines.join('\n');
}

export function sources(problems: readonly LogEntry[]): string[] {
  return [...new Set(problems.map((p) => p.source))].sort();
}

export function filterProblems(problems: readonly LogEntry[], source: string | null): LogEntry[] {
  return source ? problems.filter((p) => p.source === source) : [...problems];
}

/** One line for the clipboard. */
export function problemLine(p: LogEntry): string {
  return `${new Date(p.ts).toISOString()} ${p.level.toUpperCase()} [${p.source}] ${p.message}`;
}

/** "Not open", "OBS 32" or "OBS 32 ×2, Chrome". */
export function pagesText(pages: readonly PageConnection[]): string {
  if (!pages.length) return 'Not open';
  const counts = new Map<string, number>();
  for (const p of pages) counts.set(p.agent, (counts.get(p.agent) ?? 0) + 1);
  return [...counts].map(([agent, n]) => (n > 1 ? `${agent} ×${n}` : agent)).join(', ');
}

/** "in 3 h 20 min", "in 45 min", "expired". */
export function untilText(ts: number, now = Date.now()): string {
  const min = Math.floor((ts - now) / 60_000);
  if (min < 1) return 'expired';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `in ${h} h ${rest} min` : `in ${h} h`;
}

/** A new GitHub issue with the version in the title. Attaching the zip is up to the person. */
export function issueUrl(version: string): string {
  const title = `[v${version}] `;
  const body = 'What happened:\n\n\nWhat you expected:\n\n\nSteps to make it happen again:\n\n\n(Drag your bug report .zip here.)\n';
  return `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
