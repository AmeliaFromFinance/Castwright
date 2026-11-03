// Key combos for global hotkeys. Same names and rules as src-tauri/src/hotkeys/keys.rs.
import type { HotkeyAction } from '$lib/bindings/HotkeyAction';
import type { HotkeyBinding } from '$lib/bindings/HotkeyBinding';

const MODS = ['Ctrl', 'Alt', 'Shift', 'Super'] as const;
type Mod = (typeof MODS)[number];

const STANDALONE = ['Pause', 'ScrollLock', 'MediaPlayPause', 'MediaStop', 'MediaTrackNext', 'MediaTrackPrevious', 'VolumeUp', 'VolumeDown', 'VolumeMute'];

/** KeyboardEvent.code to key name, for codes that don't follow a pattern. */
const CODES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Backquote',
  PrintScreen: 'PrintScreen',
  Pause: 'Pause',
  ScrollLock: 'ScrollLock',
  NumpadAdd: 'NumAdd',
  NumpadSubtract: 'NumSubtract',
  NumpadMultiply: 'NumMultiply',
  NumpadDivide: 'NumDivide',
  NumpadDecimal: 'NumDecimal',
  NumpadEnter: 'NumEnter',
  MediaPlayPause: 'MediaPlayPause',
  MediaStop: 'MediaStop',
  MediaTrackNext: 'MediaTrackNext',
  MediaTrackPrevious: 'MediaTrackPrevious',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute'
};

/** Shorter labels for the screen. */
const LABELS: Record<string, string> = {
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  PrintScreen: 'PrtSc',
  NumAdd: 'Num +',
  NumSubtract: 'Num -',
  NumMultiply: 'Num *',
  NumDivide: 'Num /',
  NumDecimal: 'Num .',
  NumEnter: 'Num Enter',
  MediaPlayPause: 'Play/Pause',
  MediaStop: 'Stop',
  MediaTrackNext: 'Next track',
  MediaTrackPrevious: 'Previous track',
  VolumeUp: 'Volume up',
  VolumeDown: 'Volume down',
  VolumeMute: 'Mute'
};

export function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code);
  if (m) return m[1]!;
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (m) return code;
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return `Num${m[1]}`;
  return CODES[code] ?? null;
}

const isFunctionKey = (k: string) => /^F([1-9]|1[0-9]|2[0-4])$/.test(k);

/** Why a combo can't be used, or null when it's fine. */
export function problem(mods: Mod[], key: string): string | null {
  const alone = STANDALONE.includes(key) || isFunctionKey(key);
  if (!alone && !mods.some((m) => m !== 'Shift')) return 'Add Ctrl, Alt or Super so normal typing keeps working.';
  return null;
}

export function joinCombo(mods: Mod[], key: string): string {
  return [...MODS.filter((m) => mods.includes(m)), key].join('+');
}

export interface KeyLike {
  code: string;
  key?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type RecordResult =
  | { kind: 'cancel' }
  | { kind: 'clear' }
  /** Only modifiers so far; keep listening. */
  | { kind: 'waiting'; mods: Mod[] }
  | { kind: 'invalid'; message: string }
  | { kind: 'combo'; keys: string };

/**
 * What a key press means while recording. Plain Esc cancels and plain Backspace clears.
 * Windows and Linux match letters by their label and macOS by position, so letters
 * come from `key` except on macOS.
 */
export function readKey(e: KeyLike, mac = false): RecordResult {
  const mods: Mod[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && e.code === 'Escape') return { kind: 'cancel' };
  if (!mods.length && e.code === 'Backspace') return { kind: 'clear' };
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(e.code)) return { kind: 'waiting', mods };
  const label = !mac && /^Key[A-Z]$/.test(e.code) && e.key && /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : null;
  const key = label ?? keyFromCode(e.code);
  if (!key) return { kind: 'invalid', message: "That key can't be used as a hotkey." };
  const why = problem(mods, key);
  if (why) return { kind: 'invalid', message: why };
  return { kind: 'combo', keys: joinCombo(mods, key) };
}

/** Split a stored combo into labels for the screen, e.g. ["Ctrl", "Shift", "R"]. */
export function comboParts(keys: string, mac = false): string[] {
  if (!keys) return [];
  return keys.split('+').map((k) => {
    if (mac && k === 'Super') return 'Cmd';
    if (mac && k === 'Alt') return 'Option';
    return LABELS[k] ?? k;
  });
}

export function formatCombo(keys: string, mac = false): string {
  return comboParts(keys, mac).join(' + ');
}

export const ACTION_LABELS: Record<Exclude<HotkeyAction['type'], 'run_action'>, string> = {
  replay_last_alert: 'Replay last alert',
  skip_alert: 'Skip alert',
  toggle_alert_pause: 'Pause or resume alerts',
  toggle_alert_mute: 'Mute or unmute alerts',
  open_go_live: 'Open the go-live check'
};

export const FIXED_ACTIONS = Object.keys(ACTION_LABELS) as (keyof typeof ACTION_LABELS)[];

export function sameAction(a: HotkeyAction, b: HotkeyAction): boolean {
  if (a.type !== b.type) return false;
  return a.type !== 'run_action' || a.action_id === (b as { action_id: string }).action_id;
}

/** Shortcuts the app window uses itself. A global hotkey would take them over. */
const APP_KEYS = ['K', '1', '2', '3', '4', '5', '6', 'Comma', 'Slash', 'Equal', 'Minus', '0', 'D', 'Z'];
const APP_SHORTCUTS = new Set(
  (['Ctrl', 'Super'] as const).flatMap((m) => [...APP_KEYS.map((k) => joinCombo([m], k)), joinCombo([m, 'Shift'], 'Z')])
);

export function isAppShortcut(keys: string): boolean {
  return APP_SHORTCUTS.has(keys);
}

/** Index of another binding already using `keys`, or -1. */
export function findConflict(bindings: HotkeyBinding[], keys: string, except: number): number {
  if (!keys) return -1;
  return bindings.findIndex((b, i) => i !== except && b.keys === keys);
}

/** Rows to show: one per built-in action (set or not), then every "run action" row. */
export function rows(bindings: HotkeyBinding[]): HotkeyBinding[] {
  const fixed = FIXED_ACTIONS.map((type) => bindings.find((b) => b.action.type === type) ?? { action: { type } as HotkeyAction, keys: '' });
  return [...fixed, ...bindings.filter((b) => b.action.type === 'run_action')];
}

/** What gets saved: rows with keys, plus "run action" rows that have an action picked. */
export function toSave(list: HotkeyBinding[]): HotkeyBinding[] {
  return list.filter((b) => (b.action.type === 'run_action' ? !!b.action.action_id : !!b.keys));
}
