// Editor keyboard shortcuts.

export type ShortcutAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'duplicate' }
  | { type: 'delete' }
  | { type: 'deselect' }
  | { type: 'nudge'; dx: number; dy: number };

/** True when keys should go to a text field or code editor rather than the canvas. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('.cm-editor, [contenteditable=""], [contenteditable="true"], dialog[open]')) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file'].includes(type);
  }
  return false;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export function shortcutFor(e: KeyLike): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (key === 'y') return { type: 'redo' };
    if (key === 'd') return { type: 'duplicate' };
    return null;
  }
  if (e.altKey) return null;
  const step = e.shiftKey ? 10 : 1;
  switch (key) {
    case 'Delete':
    case 'Backspace':
      return { type: 'delete' };
    case 'Escape':
      return { type: 'deselect' };
    case 'ArrowLeft':
      return { type: 'nudge', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { type: 'nudge', dx: step, dy: 0 };
    case 'ArrowUp':
      return { type: 'nudge', dx: 0, dy: -step };
    case 'ArrowDown':
      return { type: 'nudge', dx: 0, dy: step };
  }
  return null;
}
