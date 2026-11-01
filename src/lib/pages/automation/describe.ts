import type { Action } from '$lib/bindings/Action';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { KIND_LABELS } from '$lib/format';
import type { Token } from '$lib/editors/tokens';
import { tokensFor } from '../alerts/alerts';
import { TRIGGER_LABELS } from './defaults';
import { commandName } from './validate';

export function every(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s % 3600 === 0 && s >= 3600) return `${s / 3600} h`;
  if (s % 60 === 0 && s >= 60) return `${s / 60} min`;
  if (s > 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${s} s`;
}

export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'command':
      return commandName(t.name) ? `!${commandName(t.name)}` : 'Chat command';
    case 'event':
      return KIND_LABELS[t.kind];
    case 'timer':
      return `Every ${every(t.interval_s)}`;
    case 'scene_changed':
      return t.scene ? `Scene: ${t.scene}` : 'Any scene change';
    default:
      return TRIGGER_LABELS[t.type];
  }
}

export function describeTriggers(a: Action): string {
  if (!a.triggers.length) return 'No trigger';
  return a.triggers.map(describeTrigger).join(', ');
}

function templates(steps: readonly Step[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'string' && k !== 'type') out.push(v);
    }
    if (s.type === 'if') {
      out.push(...s.conditions.conditions.map((c) => c.field));
      out.push(...templates(s.then), ...templates(s.else));
    }
  }
  return out;
}

/** `!so <arg1>` style example of how viewers use a command. */
export function commandPreview(name: string, steps: readonly Step[]): string {
  const text = templates(steps).join('\n');
  let max = 0;
  for (const m of text.matchAll(/\barg(\d+)\b/g)) max = Math.max(max, Number(m[1]));
  const parts = [`!${commandName(name) || 'command'}`];
  for (let i = 1; i <= Math.min(max, 6); i++) parts.push(i === 1 && /\b(shoutout|timeout_user)\b/.test(JSON.stringify(steps)) ? '@user' : `<arg${i}>`);
  if (max === 0 && /\binput\b/.test(text)) parts.push('<text>');
  return parts.join(' ');
}

const COMMAND_TOKENS: Token[] = [
  { token: 'name', label: 'Who typed it' },
  { token: 'user.login', label: 'Their login' },
  { token: 'arg1', label: 'First word after the command' },
  { token: 'arg2', label: 'Second word' },
  { token: 'input', label: 'Everything after the command' }
];

/** Template chips for an action, based on what its triggers provide. */
export function tokensForAction(a: Action): Token[] {
  const out: Token[] = [];
  const add = (t: Token) => {
    if (!out.some((x) => x.token === t.token)) out.push(t);
  };
  for (const t of a.triggers) {
    if (t.type === 'command') COMMAND_TOKENS.forEach(add);
    else if (t.type === 'event') tokensFor(t.kind).forEach(add);
    else if (t.type === 'scene_changed') add({ token: 'scene', label: 'New scene' });
  }
  add({ token: 'stream.title', label: 'Stream title' });
  add({ token: 'stream.uptime_text', label: 'Time live' });
  return out;
}

/** Condition fields for if-steps: trigger data plus a few common variables. */
export function fieldsForAction(a: Action, vars: Record<string, unknown>): Array<{ value: string; label: string }> {
  const fields = tokensForAction(a).map((t) => ({ value: t.token.split('|')[0]!.trim(), label: t.label ?? t.token }));
  for (const t of a.triggers) {
    if (t.type === 'command') {
      fields.push({ value: 'arg_count', label: 'Number of words after the command' });
      fields.push({ value: 'roles.moderator', label: 'Is a moderator' }, { value: 'roles.subscriber', label: 'Is a subscriber' });
    }
  }
  for (const k of Object.keys(vars).sort()) if (!fields.some((f) => f.value === k)) fields.push({ value: k, label: 'Variable' });
  return fields;
}
