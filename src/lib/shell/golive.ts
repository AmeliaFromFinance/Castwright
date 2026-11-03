import type { Check } from '$lib/bindings/Check';
import type { CheckFix } from '$lib/bindings/CheckFix';
import type { CheckStatus } from '$lib/bindings/CheckStatus';

const ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 };

/** Problems first, otherwise the order the backend sent. */
export function sortChecks(checks: readonly Check[]): Check[] {
  return checks
    .map((c, i) => [c, i] as const)
    .sort((a, b) => ORDER[a[0].status] - ORDER[b[0].status] || a[1] - b[1])
    .map(([c]) => c);
}

export interface Tally {
  fail: number;
  warn: number;
  pass: number;
}

export function tally(checks: readonly Check[]): Tally {
  const t: Tally = { fail: 0, warn: 0, pass: 0 };
  for (const c of checks) t[c.status]++;
  return t;
}

export function summaryText(t: Tally): string {
  if (!t.fail && !t.warn) return 'All good';
  const parts = [];
  if (t.fail) parts.push(t.fail === 1 ? '1 problem' : `${t.fail} problems`);
  if (t.warn) parts.push(t.warn === 1 ? '1 warning' : `${t.warn} warnings`);
  return parts.join(', ');
}

export function fixLabel(fix: CheckFix): string {
  switch (fix.type) {
    case 'connect_obs':
      return 'Connect';
    case 'start_server':
      return 'Restart';
    case 'resume_alerts':
      return 'Resume';
    case 'unmute_alerts':
      return 'Unmute';
    case 'fix_overlay_link':
      return 'Fix link';
    case 'reload_source':
      return 'Reload';
    case 'open':
      return 'Open';
  }
}

/** Went from offline to live. The first reading (prev = null) never counts. */
export function wentLive(prev: boolean | null, now: boolean): boolean {
  return prev === false && now;
}

/** Ticks for items that still exist. */
export function keepTicks(ticked: ReadonlySet<string>, itemIds: readonly string[]): Set<string> {
  return new Set(itemIds.filter((id) => ticked.has(id)));
}
