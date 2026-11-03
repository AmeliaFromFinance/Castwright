import { describe, expect, it } from 'vitest';
import type { HotkeyBinding } from '$lib/bindings/HotkeyBinding';
import {
  comboParts,
  findConflict,
  formatCombo,
  isAppShortcut,
  keyFromCode,
  pickedId,
  readKey,
  rows,
  sameAction,
  soundHotkey,
  toSave,
  withSoundHotkey,
  type KeyLike
} from './hotkeys';

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
});

describe('readKey', () => {
  it('reads combos in a fixed modifier order', () => {
    expect(readKey(key('KeyR', { shiftKey: true, ctrlKey: true }))).toEqual({ kind: 'combo', keys: 'Ctrl+Shift+R' });
    expect(readKey(key('Digit1', { metaKey: true, altKey: true }))).toEqual({ kind: 'combo', keys: 'Alt+Super+1' });
    expect(readKey(key('ArrowUp', { ctrlKey: true }))).toEqual({ kind: 'combo', keys: 'Ctrl+Up' });
    expect(readKey(key('Numpad5', { altKey: true }))).toEqual({ kind: 'combo', keys: 'Alt+Num5' });
  });

  it('takes letters from the layout, except on macOS', () => {
    // The key labelled Z on a German keyboard sits where Y is on a US one.
    const z = key('KeyY', { key: 'z', ctrlKey: true, altKey: true });
    expect(readKey(z)).toEqual({ kind: 'combo', keys: 'Ctrl+Alt+Z' });
    expect(readKey(z, true)).toEqual({ kind: 'combo', keys: 'Ctrl+Alt+Y' });
    // Non-Latin layouts fall back to the position.
    expect(readKey(key('KeyZ', { key: 'я', ctrlKey: true }))).toEqual({ kind: 'combo', keys: 'Ctrl+Z' });
  });

  it('allows function and media keys alone', () => {
    expect(readKey(key('F13'))).toEqual({ kind: 'combo', keys: 'F13' });
    expect(readKey(key('F5', { shiftKey: true }))).toEqual({ kind: 'combo', keys: 'Shift+F5' });
    expect(readKey(key('MediaPlayPause'))).toEqual({ kind: 'combo', keys: 'MediaPlayPause' });
  });

  it('plain Esc cancels and plain Backspace clears', () => {
    expect(readKey(key('Escape'))).toEqual({ kind: 'cancel' });
    expect(readKey(key('Backspace'))).toEqual({ kind: 'clear' });
    expect(readKey(key('Escape', { ctrlKey: true }))).toEqual({ kind: 'combo', keys: 'Ctrl+Escape' });
    expect(readKey(key('Backspace', { altKey: true }))).toEqual({ kind: 'combo', keys: 'Alt+Backspace' });
  });

  it('waits while only modifiers are down', () => {
    expect(readKey(key('ControlLeft', { ctrlKey: true }))).toEqual({ kind: 'waiting', mods: ['Ctrl'] });
    expect(readKey(key('ShiftRight', { shiftKey: true, altKey: true }))).toEqual({ kind: 'waiting', mods: ['Alt', 'Shift'] });
  });

  it('refuses combos that would break typing', () => {
    expect(readKey(key('KeyR')).kind).toBe('invalid');
    expect(readKey(key('KeyR', { shiftKey: true })).kind).toBe('invalid');
    expect(readKey(key('Space', { shiftKey: true })).kind).toBe('invalid');
    expect(readKey(key('IntlBackslash', { ctrlKey: true })).kind).toBe('invalid');
  });
});

describe('names', () => {
  it('maps codes', () => {
    expect(keyFromCode('KeyA')).toBe('A');
    expect(keyFromCode('F24')).toBe('F24');
    expect(keyFromCode('F25')).toBeNull();
    expect(keyFromCode('NumpadEnter')).toBe('NumEnter');
    expect(keyFromCode('AudioVolumeUp')).toBe('VolumeUp');
  });

  it('formats for the screen', () => {
    expect(formatCombo('Ctrl+Shift+BracketLeft')).toBe('Ctrl + Shift + [');
    expect(comboParts('Alt+Super+Up', true)).toEqual(['Option', 'Cmd', '↑']);
    expect(comboParts('')).toEqual([]);
  });
});

describe('bindings', () => {
  const list: HotkeyBinding[] = [
    { action: { type: 'run_action', action_id: 'a1' }, keys: 'Ctrl+Alt+1' },
    { action: { type: 'skip_alert' }, keys: 'Ctrl+Alt+S' }
  ];

  it('lists every built-in action first', () => {
    const r = rows(list);
    expect(r.map((b) => b.action.type)).toEqual(['replay_last_alert', 'skip_alert', 'toggle_alert_pause', 'toggle_alert_mute', 'open_go_live', 'add_marker', 'create_clip', 'run_action']);
    expect(r[1]!.keys).toBe('Ctrl+Alt+S');
    expect(r[0]!.keys).toBe('');
  });

  it('finds conflicts but not with itself', () => {
    expect(findConflict(list, 'Ctrl+Alt+S', 0)).toBe(1);
    expect(findConflict(list, 'Ctrl+Alt+S', 1)).toBe(-1);
    expect(findConflict(list, '', 0)).toBe(-1);
  });

  it('knows the shortcuts the app window uses', () => {
    expect(isAppShortcut('Ctrl+K')).toBe(true);
    expect(isAppShortcut('Super+Comma')).toBe(true);
    expect(isAppShortcut('Ctrl+Shift+Z')).toBe(true);
    expect(isAppShortcut('Shift+Super+Z')).toBe(true);
    expect(isAppShortcut('Ctrl+Alt+K')).toBe(false);
  });

  it('saves only rows that mean something', () => {
    const saved = toSave([
      ...rows(list),
      { action: { type: 'run_action', action_id: '' }, keys: 'Ctrl+Alt+9' },
      { action: { type: 'run_action', action_id: 'a2' }, keys: '' }
    ]);
    expect(saved.map((b) => b.action.type)).toEqual(['skip_alert', 'run_action', 'run_action']);
  });

  it('keeps one combo per soundboard button', () => {
    let b = withSoundHotkey(list, 'horn', 'Ctrl+Alt+H');
    b = withSoundHotkey(b, 'drum', 'Ctrl+Alt+D');
    b = withSoundHotkey(b, 'horn', 'Ctrl+Alt+J');
    expect(soundHotkey(b, 'horn')).toBe('Ctrl+Alt+J');
    expect(b.filter((x) => x.action.type === 'play_sound_button')).toHaveLength(2);
    expect(rows(b).slice(-2).map((x) => pickedId(x.action))).toEqual(['drum', 'horn']);
    b = withSoundHotkey(b, 'horn', '');
    expect(soundHotkey(b, 'horn')).toBe('');
    expect(toSave([...b, { action: { type: 'play_sound_button', sound_id: '' }, keys: 'Ctrl+Alt+9' }])).toEqual(b);
    expect(sameAction({ type: 'play_sound_button', sound_id: 'a' }, { type: 'play_sound_button', sound_id: 'b' })).toBe(false);
  });
});
