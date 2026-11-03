import type { Problem } from './usage';

/** One line about a problem, for lists and cards. */
export function problemText(p: Problem | null): string | null {
  if (!p) return null;
  if (p.type === 'unread') return 'Saved, but nothing uses it.';
  return p.suggestion ? `Nothing sets it. Did you mean ${p.suggestion}?` : 'Nothing sets it. Check the spelling.';
}

/** "Text", "Number", "True or false"... */
export function typeOf(v: unknown, exists: boolean): string {
  if (!exists) return 'Not set';
  if (typeof v === 'number') return 'Number';
  if (typeof v === 'boolean') return 'True or false';
  if (typeof v === 'string') return v === '' ? 'Text (empty)' : 'Text';
  return 'List or group';
}
