// State for one open overlay: the document, selection, undo history and saving.
import type { Event } from '$lib/bindings/Event';
import type { Layer } from '$lib/bindings/Layer';
import type { Overlay } from '$lib/bindings/Overlay';
import { errorMessage } from '$lib/api/backend';
import { Feed } from '$lib/overlay/feed';
import type { ActiveAlert, WidgetState } from '$lib/overlay/state';
import { roundRect, type Rect } from './geometry';
import { History } from './history';
import { createLayer, duplicateLayer, moveLayer, reorderFromList, uniqueName, type LayerType } from './layers';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface ChangeOptions {
  /** Changes with the same key close together become one undo step. */
  key?: string;
  windowMs?: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Copied layers, shared by every editor in this window so they paste into other overlays too. */
let clipboard: Layer[] = [];
/** Compares content only; the backend sets `updated_at`. */
const contentKey = (o: Overlay) => JSON.stringify({ ...o, updated_at: 0 });

export class EditorStore {
  doc: Overlay = $state() as Overlay;
  /** Selected layers in the order they were picked; the last one is the main one. */
  selectedIds = $state<string[]>([]);
  saveState = $state<SaveState>('saved');
  saveError = $state<string | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);

  // view
  zoom = $state(1);
  fit = $state(true);
  snapping = $state(true);
  showHidden = $state(true);
  /** Show the canvas as in this OBS scene; '' ignores scene rules. */
  previewScene = $state('');
  safeArea = $state(false);
  animate = $state(false);
  sound = $state(false);

  // test data shown only in the editor
  testAlert = $state<ActiveAlert | null>(null);
  testEvents = $state<Event[]>([]);
  testChat = $state<Event[]>([]);
  varOverrides = $state<Record<string, unknown>>({});
  widgetState = $state<WidgetState>({});
  readonly feed = new Feed();

  private history = new History<Overlay>(100, 1000);
  private savedKey: string;
  /** Layer visibility as last saved, to spot changes made elsewhere (automation). */
  private savedVisible = new Map<string, boolean>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private gestureSeq = 0;
  private gesture: string | null = null;

  constructor(
    overlay: Overlay,
    private readonly saveFn: (o: Overlay) => Promise<unknown>,
    readonly debounceMs = 600
  ) {
    this.doc = clone(overlay);
    this.savedKey = contentKey(overlay);
    this.rememberVisible(overlay);
  }

  /** The main selected layer: the only one, or the last one picked. */
  get selectedId(): string | null {
    return this.selectedIds[this.selectedIds.length - 1] ?? null;
  }

  set selectedId(id: string | null) {
    this.selectedIds = id ? [id] : [];
  }

  get selected(): Layer | null {
    return this.doc.layers.find((l) => l.id === this.selectedId) ?? null;
  }

  /** Selected layers in paint order (back first). */
  get selection(): Layer[] {
    return this.doc.layers.filter((l) => this.selectedIds.includes(l.id));
  }

  get multi(): boolean {
    return this.selectedIds.length > 1;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  layer(id: string): Layer | undefined {
    return this.doc.layers.find((l) => l.id === id);
  }

  get dirty(): boolean {
    return contentKey($state.snapshot(this.doc) as Overlay) !== this.savedKey;
  }

  /** Applies a change as one undoable step (or part of one, see `key`). */
  change(fn: (doc: Overlay) => void, opts: ChangeOptions = {}): void {
    const before = $state.snapshot(this.doc) as Overlay;
    fn(this.doc);
    const after = $state.snapshot(this.doc) as Overlay;
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.history.record(before, opts.key ?? null, Date.now(), opts.windowMs);
    this.afterChange();
  }

  /** Change one layer. */
  changeLayer(id: string, fn: (l: Layer) => void, opts?: ChangeOptions): void {
    this.change((d) => {
      const l = d.layers.find((x) => x.id === id);
      if (l) fn(l);
    }, opts);
  }

  /** Change several layers as one undo step. `fn` gets them in paint order. */
  changeLayers(ids: readonly string[], fn: (ls: Layer[]) => void, opts?: ChangeOptions): void {
    this.change((d) => {
      const ls = d.layers.filter((l) => ids.includes(l.id));
      if (ls.length) fn(ls);
    }, opts);
  }

  /** Change each selected layer. */
  changeSelected(fn: (l: Layer) => void, opts?: ChangeOptions): void {
    this.changeLayers(this.selectedIds, (ls) => ls.forEach(fn), opts);
  }

  private afterChange() {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    this.pruneSelection();
    this.schedule();
  }

  private pruneSelection() {
    const kept = this.selectedIds.filter((id) => this.layer(id));
    if (kept.length !== this.selectedIds.length) this.selectedIds = kept;
  }

  undo(): void {
    const prev = this.history.undo($state.snapshot(this.doc) as Overlay);
    if (prev) {
      this.doc = prev;
      this.afterChange();
    }
  }

  redo(): void {
    const next = this.history.redo($state.snapshot(this.doc) as Overlay);
    if (next) {
      this.doc = next;
      this.afterChange();
    }
  }

  // --- drags ---------------------------------------------------------------

  /** Starts a drag; every change until `endGesture` is one undo step. */
  beginGesture(): void {
    this.gesture = `gesture:${++this.gestureSeq}`;
  }

  endGesture(): void {
    this.gesture = null;
    this.history.seal();
  }

  /** Moves layers to `start` plus the offset, during a drag of several. */
  moveGroup(starts: ReadonlyMap<string, { x: number; y: number }>, dx: number, dy: number): void {
    const opts = this.gesture ? { key: this.gesture, windowMs: Infinity } : { key: 'group-move' };
    this.changeLayers([...starts.keys()], (ls) => {
      for (const l of ls) {
        const s = starts.get(l.id)!;
        l.x = Math.round(s.x + dx);
        l.y = Math.round(s.y + dy);
      }
    }, opts);
  }

  setRect(id: string, r: Partial<Rect>): void {
    const opts = this.gesture ? { key: this.gesture, windowMs: Infinity } : { key: `rect:${id}` };
    this.changeLayer(id, (l) => Object.assign(l, r), opts);
  }

  setBox(id: string, r: Rect): void {
    this.setRect(id, roundRect(r));
  }

  nudge(dx: number, dy: number): void {
    const ids = this.selection.filter((l) => !l.locked).map((l) => l.id);
    if (!ids.length) return;
    this.changeLayers(ids, (ls) => {
      for (const x of ls) {
        x.x = Math.round(x.x + dx);
        x.y = Math.round(x.y + dy);
      }
    }, { key: `nudge:${ids.join(',')}` });
  }

  // --- layers --------------------------------------------------------------

  select(id: string | null): void {
    this.selectedId = id && this.layer(id) ? id : null;
  }

  /** Ctrl-click: adds or takes out one layer. */
  toggleSelect(id: string): void {
    if (!this.layer(id)) return;
    this.selectedIds = this.isSelected(id) ? this.selectedIds.filter((x) => x !== id) : [...this.selectedIds, id];
  }

  /** Shift-click: everything between the main selected layer and `id` in `order`, which is how a list shows them. */
  selectRange(id: string, order: readonly string[]): void {
    const from = order.indexOf(this.selectedId ?? id);
    const to = order.indexOf(id);
    if (to < 0) return;
    const range = order.slice(Math.min(from < 0 ? to : from, to), Math.max(from, to) + 1);
    // Keep the clicked one last so it becomes the main one.
    this.selectedIds = [...range.filter((x) => x !== id), id];
  }

  selectMany(ids: readonly string[]): void {
    this.selectedIds = ids.filter((id, i) => this.layer(id) && ids.indexOf(id) === i);
  }

  selectAll(): void {
    this.selectedIds = this.doc.layers.map((l) => l.id);
  }

  addLayer(type: LayerType): Layer {
    const l = createLayer(type, $state.snapshot(this.doc) as Overlay);
    this.change((d) => {
      d.layers.push(l);
    });
    this.selectedId = l.id;
    return l;
  }

  remove(id: string): void {
    this.removeMany([id]);
  }

  removeMany(ids: readonly string[]): void {
    this.change((d) => {
      d.layers = d.layers.filter((l) => !ids.includes(l.id));
    });
  }

  duplicate(id: string): void {
    this.duplicateMany([id]);
  }

  /** Copies sit right above their originals; the copies end up selected. */
  duplicateMany(ids: readonly string[]): void {
    const names = this.doc.layers.map((l) => l.name);
    const copies: Layer[] = [];
    this.change((d) => {
      for (const src of d.layers.filter((l) => ids.includes(l.id))) {
        const copy = duplicateLayer($state.snapshot(src) as Layer, names);
        names.push(copy.name);
        copies.push(copy);
        d.layers.splice(d.layers.findIndex((l) => l.id === src.id) + 1, 0, copy);
      }
    });
    if (copies.length) this.selectedIds = copies.map((c) => c.id);
  }

  /** Copies the selected layers for `paste`. Returns how many. */
  copy(): number {
    clipboard = this.selection.map((l) => $state.snapshot(l) as Layer);
    return clipboard.length;
  }

  get canPaste(): boolean {
    return clipboard.length > 0;
  }

  /** Adds the copied layers on top, a little offset when they'd land on their originals. */
  paste(): void {
    if (!clipboard.length) return;
    const names = this.doc.layers.map((l) => l.name);
    const here = clipboard.some((c) => this.doc.layers.some((l) => l.id === c.id || (l.x === c.x && l.y === c.y && l.name === c.name)));
    const copies = clipboard.map((c) => {
      const copy = duplicateLayer(structuredClone(c), names, here ? 24 : 0);
      copy.name = here ? copy.name : uniqueName(c.name, names);
      names.push(copy.name);
      return copy;
    });
    this.change((d) => {
      d.layers.push(...copies);
    });
    // The next paste lands a step further along.
    if (here) clipboard = copies.map((c) => structuredClone(c));
    this.selectedIds = copies.map((c) => c.id);
  }

  /** +1 brings forward, -1 sends backward. */
  move(id: string, delta: number): void {
    this.change((d) => {
      d.layers = moveLayer($state.snapshot(d.layers) as Layer[], id, delta);
    });
  }

  /** Drag and drop in the front-first layer list. */
  moveInList(fromRow: number, beforeRow: number): void {
    this.change((d) => {
      d.layers = reorderFromList($state.snapshot(d.layers) as Layer[], fromRow, beforeRow);
    });
  }

  rename(id: string, name: string): void {
    const n = name.trim();
    if (n) this.changeLayer(id, (l) => (l.name = n));
  }

  toggleVisible(id: string): void {
    this.changeLayer(id, (l) => (l.visible = !l.visible));
  }

  toggleLocked(id: string): void {
    this.changeLayer(id, (l) => (l.locked = !l.locked));
  }

  // --- saving --------------------------------------------------------------

  private schedule() {
    if (!this.dirty) {
      if (!this.inflight && this.saveState !== 'error') this.saveState = 'saved';
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    this.saveState = 'pending';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), this.debounceMs);
  }

  private async save(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.inflight) await this.inflight;
    const snap = $state.snapshot(this.doc) as Overlay;
    const key = contentKey(snap);
    if (key === this.savedKey) {
      this.saveState = 'saved';
      return;
    }
    this.saveState = 'saving';
    this.saveError = null;
    this.inflight = this.saveFn(snap)
      .then(() => {
        this.savedKey = key;
        this.rememberVisible(snap);
        this.saveState = 'saved';
      })
      .catch((e: unknown) => {
        this.saveState = 'error';
        this.saveError = errorMessage(e);
      })
      .finally(() => {
        this.inflight = null;
      });
    await this.inflight;
    if ((this.saveState as SaveState) === 'saved' && this.dirty && !this.timer) this.schedule();
  }

  /** Saves now if anything is waiting. Resolves true when everything is saved. */
  async flush(): Promise<boolean> {
    if (this.timer || this.dirty) await this.save();
    else if (this.inflight) await this.inflight;
    return !this.dirty && this.saveState !== 'error';
  }

  retry(): void {
    void this.save();
  }

  /**
   * The project was reloaded (another window, automation, our own save coming back).
   * Takes the new version only when there are no local edits waiting.
   * Returns false if the overlay no longer exists.
   */
  syncRemote(remote: Overlay | undefined): boolean {
    if (!remote) return false;
    if (this.timer || this.inflight || this.dirty) {
      // Keep local edits, but take show/hide changes made by automation so the
      // next save doesn't undo them.
      for (const r of remote.layers) {
        const before = this.savedVisible.get(r.id);
        if (before === undefined || before === r.visible) continue;
        const local = this.doc.layers.find((l) => l.id === r.id);
        if (local) local.visible = r.visible;
        this.savedVisible.set(r.id, r.visible);
      }
      return true;
    }
    const key = contentKey(remote);
    if (key === this.savedKey) return true;
    this.history.record($state.snapshot(this.doc) as Overlay, null);
    this.doc = clone(remote);
    this.savedKey = key;
    this.rememberVisible(remote);
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    this.pruneSelection();
    return true;
  }

  private rememberVisible(o: Overlay): void {
    this.savedVisible = new Map(o.layers.map((l) => [l.id, l.visible]));
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
