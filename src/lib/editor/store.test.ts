import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from '$lib/bindings/Overlay';
import { newOverlay } from './starter';
import { EditorStore } from './store.svelte';

function setup(save = vi.fn((o: Overlay) => Promise.resolve(o))) {
  const overlay = newOverlay('Test', 1920, 1080, true);
  const store = new EditorStore(overlay, save, 600);
  return { overlay, store, save };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('EditorStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('works on a copy of the overlay', () => {
    const { overlay, store } = setup();
    store.changeLayer(overlay.layers[0]!.id, (l) => (l.x = 999));
    expect(overlay.layers[0]!.x).not.toBe(999);
  });

  it('saves once, 600 ms after the last change', async () => {
    const { store, save } = setup();
    const id = store.doc.layers[0]!.id;
    store.setRect(id, { x: 10 });
    vi.advanceTimersByTime(400);
    store.setRect(id, { x: 20 });
    vi.advanceTimersByTime(400);
    expect(save).not.toHaveBeenCalled();
    expect(store.saveState).toBe('pending');
    vi.advanceTimersByTime(200);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].layers[0]!.x).toBe(20);
    expect(store.saveState).toBe('saved');
  });

  it('flush saves straight away', async () => {
    const { store, save } = setup();
    store.addLayer('text');
    expect(await store.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.dirty).toBe(false);
  });

  it('keeps edits and reports errors when saving fails', async () => {
    const save = vi.fn(() => Promise.reject({ code: 'io', message: 'Disk full' }));
    const { store } = setup(save);
    store.addLayer('shape');
    expect(await store.flush()).toBe(false);
    expect(store.saveState).toBe('error');
    expect(store.saveError).toBe('Disk full');
    expect(store.dirty).toBe(true);
  });

  it('ignores changes that change nothing', () => {
    const { store } = setup();
    const l = store.doc.layers[0]!;
    store.setRect(l.id, { x: l.x });
    expect(store.canUndo).toBe(false);
    expect(store.saveState).toBe('saved');
  });

  it('undo and redo restore whole snapshots', () => {
    const { store } = setup();
    const before = store.doc.layers.length;
    store.addLayer('text');
    expect(store.doc.layers.length).toBe(before + 1);
    store.undo();
    expect(store.doc.layers.length).toBe(before);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.doc.layers.length).toBe(before + 1);
  });

  it('a drag is one undo step', () => {
    const { store } = setup();
    const l = store.doc.layers[0]!;
    const x0 = l.x;
    store.beginGesture();
    for (let i = 1; i <= 20; i++) {
      vi.advanceTimersByTime(500);
      store.setRect(l.id, { x: x0 + i });
    }
    store.endGesture();
    store.setRect(l.id, { y: 5 });
    store.undo();
    expect(store.doc.layers[0]!.x).toBe(x0 + 20);
    store.undo();
    expect(store.doc.layers[0]!.x).toBe(x0);
  });

  it('rapid typing in one field is one undo step', () => {
    const { store } = setup();
    const l = store.addLayer('text');
    for (const t of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      vi.advanceTimersByTime(100);
      store.changeLayer(l.id, (x) => x.kind.type === 'text' && (x.kind.text = t), { key: `text:${l.id}` });
    }
    store.undo();
    const back = store.layer(l.id)!;
    expect(back.kind.type === 'text' && back.kind.text).toBe('Your text here');
  });

  it('nudges, skipping locked layers', () => {
    const { store } = setup();
    const l = store.doc.layers[0]!;
    const x0 = l.x;
    store.select(l.id);
    store.nudge(10, -1);
    expect(store.selected!.x).toBe(x0 + 10);
    store.toggleLocked(l.id);
    store.nudge(10, 0);
    expect(store.selected!.x).toBe(x0 + 10);
  });

  it('duplicates above the original and selects the copy', () => {
    const { store } = setup();
    const id = store.doc.layers[1]!.id;
    store.duplicate(id);
    expect(store.doc.layers[2]!.id).toBe(store.selectedId);
    expect(store.doc.layers[2]!.name).toMatch(/copy$/);
  });

  it('deselects a removed layer', () => {
    const { store } = setup();
    const id = store.doc.layers[0]!.id;
    store.select(id);
    store.remove(id);
    expect(store.selectedId).toBeNull();
  });

  it('reorders', () => {
    const { store } = setup();
    const ids = store.doc.layers.map((l) => l.id);
    store.move(ids[0]!, 1);
    expect(store.doc.layers.map((l) => l.id)).toEqual([ids[1], ids[0], ...ids.slice(2)]);
  });

  it('takes remote changes only when there are no local edits', async () => {
    const { store, overlay } = setup();
    const remote = structuredClone(overlay);
    remote.name = 'Renamed elsewhere';
    expect(store.syncRemote(remote)).toBe(true);
    expect(store.doc.name).toBe('Renamed elsewhere');

    store.change((d) => (d.name = 'Local edit'));
    const again = structuredClone(remote);
    again.name = 'Second remote';
    store.syncRemote(again);
    expect(store.doc.name).toBe('Local edit');
    expect(store.syncRemote(undefined)).toBe(false);
  });

  it('ignores its own save coming back', async () => {
    const { store, save } = setup();
    store.change((d) => (d.name = 'Mine'));
    await store.flush();
    const echoed = { ...(save.mock.calls[0]![0] as Overlay), updated_at: 12345 };
    store.syncRemote(echoed);
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.doc.name).toBe('Test');
  });
});
