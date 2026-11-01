import type { Action } from '$lib/bindings/Action';
import type { Overlay } from '$lib/bindings/Overlay';
import { parseNumber } from '$lib/logic/condition';
import { stepKey, walk } from './tree';

/** Same rule as vars::valid_key in Rust. */
export function isValidVarKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 128 &&
    !key.startsWith('.') &&
    !key.endsWith('.') &&
    !key.includes('..') &&
    /^[A-Za-z0-9._-]+$/.test(key)
  );
}

export const VAR_KEY_HELP = 'Use letters, numbers, dots, dashes and underscores, e.g. counter.deaths';
export const MIN_TIMER_S = 10;
export const MAX_DELAY_MS = 10 * 60 * 1000;

export interface Issue {
  /** "name", "trigger.0", "step.2.then.0" ... */
  key: string;
  message: string;
  /** Warnings don't block saving. */
  warn?: boolean;
}

const hasTemplate = (s: string) => s.includes('{{');

/** Strip a leading "!" and surrounding space. */
export function commandName(s: string): string {
  return s.trim().replace(/^!+/, '').trim();
}

export function validateAction(a: Action, all: readonly Action[], overlays: readonly Overlay[] = []): Issue[] {
  const out: Issue[] = [];
  if (!a.name.trim()) out.push({ key: 'name', message: 'Give the action a name.' });

  a.triggers.forEach((t, i) => {
    const key = `trigger.${i}`;
    if (t.type === 'command') {
      const name = commandName(t.name);
      if (!name) out.push({ key, message: 'Type the command name, e.g. so for !so.' });
      else if (/\s/.test(name)) out.push({ key, message: 'Command names are a single word.' });
      else {
        const clash = all.find(
          (o) =>
            o.id !== a.id &&
            o.enabled &&
            o.triggers.some(
              (x) =>
                x.type === 'command' &&
                [x.name, ...x.aliases].some((n) => commandName(n).toLowerCase() === name.toLowerCase())
            )
        );
        if (clash) out.push({ key, message: `"${clash.name}" also answers to !${name}; both will run.`, warn: true });
      }
      if (t.aliases.some((x) => /\s/.test(commandName(x)))) out.push({ key, message: 'Aliases are single words.' });
    } else if (t.type === 'timer') {
      if (!(t.interval_s >= MIN_TIMER_S))
        out.push({ key, message: `Timers can run at most every ${MIN_TIMER_S} seconds, so shorter intervals are raised to ${MIN_TIMER_S} s.` });
    }
  });

  for (const { step: s, path, index } of walk(a.steps)) {
    const key = `step.${stepKey(path, index)}`;
    const add = (message: string, warn = false) => out.push({ key, message, warn });
    switch (s.type) {
      case 'chat_send':
      case 'chat_announce':
        if (!s.message.trim()) add('Type the message to send.');
        break;
      case 'shoutout':
      case 'timeout_user':
        if (!s.user.trim()) add('Who? Use a login or a template like {{arg1}}.');
        break;
      case 'set_variable':
      case 'add_to_variable':
        if (!s.key.trim()) add('Name the variable.');
        else if (!hasTemplate(s.key) && !isValidVarKey(s.key.trim())) add(`"${s.key}" isn't a valid variable name. ${VAR_KEY_HELP}.`);
        break;
      case 'http_request': {
        const url = s.url.trim();
        if (!url) add('Enter the web address.');
        else if (!hasTemplate(url) && !/^https?:\/\/\S+$/i.test(url)) add('Only http:// and https:// addresses work.');
        if (s.save_to.trim() && !hasTemplate(s.save_to) && !isValidVarKey(s.save_to.trim()))
          add(`"${s.save_to}" isn't a valid variable name. ${VAR_KEY_HELP}.`);
        break;
      }
      case 'run_action':
        if (!s.action_id) add('Pick the action to run.');
        else if (s.action_id === a.id) add("An action can't run itself.");
        else if (!all.some((o) => o.id === s.action_id)) add('That action no longer exists.');
        break;
      case 'delay':
        if (s.ms > MAX_DELAY_MS) add('Waits are capped at 10 minutes.', true);
        break;
      case 'switch_scene':
        if (!s.scene.trim()) add('Pick a scene.');
        break;
      case 'set_source_visible':
        if (!s.source.trim()) add('Pick a source.');
        break;
      case 'set_input_mute':
        if (!s.input.trim()) add('Pick an audio source.');
        break;
      case 'set_layer_visible': {
        const o = overlays.find((x) => x.id === s.overlay_id);
        if (!s.overlay_id || !s.layer_id) add('Pick an overlay and a layer.');
        else if (overlays.length && (!o || !o.layers.some((l) => l.id === s.layer_id))) add('That layer no longer exists.');
        break;
      }
      case 'play_sound':
        if (!s.src.trim()) add('Pick a sound.');
        break;
      case 'play_alert':
        if (!s.title.trim() && !s.message.trim()) add('Give the alert a title or a message.');
        break;
      case 'run_script':
        if (!s.code.trim()) add('Write the script.');
        break;
      case 'log':
        if (!s.message.trim()) add('Type the text to log.');
        break;
      default:
        break;
    }
  }
  return out;
}

export function blocking(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => !i.warn);
}

/**
 * Text from the variables editor to a value. Numbers stay numbers, true/false
 * become booleans; a variable that was text stays text.
 */
export function parseVarValue(text: string, previous?: unknown): unknown {
  if (typeof previous === 'string') return text;
  const t = text.trim();
  const n = parseNumber(t);
  if (n !== null) return n;
  if (t === 'true' || t === 'false') return t === 'true';
  return text;
}

export function varText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
