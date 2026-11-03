import type { BackupReason } from '$lib/bindings/BackupReason';

export const REASON_LABELS: Record<BackupReason, string> = {
  startup: 'App start',
  daily: 'Daily',
  manual: 'Back up now',
  before_restore: 'Before restore',
  before_import: 'Before import',
  before_migration: 'Before upgrade'
};

/** "3 Nov 2026, 14:05" in the local time zone. */
export function backupDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
