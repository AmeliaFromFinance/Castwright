import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor } from './keys';

const k = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
});

describe('shortcutFor', () => {
  it('maps undo and redo for Ctrl and Cmd', () => {
    expect(shortcutFor(k('z', { ctrlKey: true }))).toEqual({ type: 'undo' });
    expect(shortcutFor(k('z', { metaKey: true }))).toEqual({ type: 'undo' });
    expect(shortcutFor(k('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'redo' });
    expect(shortcutFor(k('y', { ctrlKey: true }))).toEqual({ type: 'redo' });
  });

  it('maps duplicate, delete and escape', () => {
    expect(shortcutFor(k('d', { metaKey: true }))).toEqual({ type: 'duplicate' });
    expect(shortcutFor(k('Delete'))).toEqual({ type: 'delete' });
    expect(shortcutFor(k('Backspace'))).toEqual({ type: 'delete' });
    expect(shortcutFor(k('Escape'))).toEqual({ type: 'deselect' });
  });

  it('nudges 1px, or 10px with Shift', () => {
    expect(shortcutFor(k('ArrowLeft'))).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(shortcutFor(k('ArrowDown', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 0, dy: 10 });
  });

  it('ignores everything else', () => {
    expect(shortcutFor(k('a'))).toBeNull();
    expect(shortcutFor(k('1', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(k('ArrowLeft', { altKey: true }))).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('is true for text fields and code editors', () => {
    document.body.innerHTML = `
      <input id="t" type="text"><input id="n" type="number"><input id="c" type="checkbox">
      <textarea id="ta"></textarea><select id="s"></select><button id="b"></button>
      <div class="cm-editor"><div id="cm" contenteditable="true"></div></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(isTypingTarget(el('t'))).toBe(true);
    expect(isTypingTarget(el('n'))).toBe(true);
    expect(isTypingTarget(el('ta'))).toBe(true);
    expect(isTypingTarget(el('s'))).toBe(true);
    expect(isTypingTarget(el('cm'))).toBe(true);
    expect(isTypingTarget(el('c'))).toBe(false);
    expect(isTypingTarget(el('b'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
