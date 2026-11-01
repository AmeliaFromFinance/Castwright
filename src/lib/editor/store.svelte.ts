// State for one open overlay: the document, selection, undo history and saving.
import type { Event } from '$lib/bindings/Event';
import type { Layer } from '$lib/bindings/Layer';
import type { Overlay } from '$lib/bindings/Overlay';
import { errorMessage } from '$lib/api/backend';
import { Feed } from '$lib/overlay/feed';
import type { ActiveAlert, WidgetState } from '$lib/overlay/state';
import { roundRect, type Rect } from './geometry';
import { History } from './history';
import { createLayer, duplicateLayer, moveLayer, reorderFromList, type LayerType } from './layers';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface ChangeOptions {
  /** Changes with the same key close together become one undo step. */
  key?: string;
  windowMs?: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** Compares content only; the backend sets `updated_at`. */
const contentKey = (o: Overlay) => JSON.stringify({ ...o, updated_at: 0 });

export class EditorStore {
  doc: Overlay = $state() as Overlay;
  selectedId = $state<string | null>(null);
  saveState = $state<SaveState>('saved');
  saveError = $state<string | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);

  // view
  zoom = $state(1);
  fit = $state(true);
  snapping = $state(true);
  showHidden = $state(true);
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
  }

  get selected(): Layer | null {
    return this.doc.layers.find((l) => l.id === this.selectedId) ?? null;
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

  private afterChange() {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    if (this.selectedId && !this.layer(this.selectedId)) this.selectedId = null;
    this.schedule();
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

  setRect(id: string, r: Partial<Rect>): void {
    const opts = this.gesture ? { key: this.gesture, windowMs: Infinity } : { key: `rect:${id}` };
    this.changeLayer(id, (l) => Object.assign(l, r), opts);
  }

  setBox(id: string, r: Rect): void {
    this.setRect(id, roundRect(r));
  }

  nudge(dx: number, dy: number): void {
    const l = this.selected;
    if (!l || l.locked) return;
    this.changeLayer(l.id, (x) => {
      x.x = Math.round(x.x + dx);
      x.y = Math.round(x.y + dy);
    }, { key: `nudge:${l.id}` });
  }

  // --- layers --------------------------------------------------------------

  select(id: string | null): void {
    this.selectedId = id && this.layer(id) ? id : null;
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
    this.change((d) => {
      d.layers = d.layers.filter((l) => l.id !== id);
    });
  }

  duplicate(id: string): void {
    const src = this.layer(id);
    if (!src) return;
    const copy = duplicateLayer($state.snapshot(src) as Layer, this.doc.layers.map((l) => l.name));
    this.change((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      d.layers.splice(i + 1, 0, copy);
    });
    this.selectedId = copy.id;
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
    if (this.timer || this.inflight || this.dirty) return true;
    const key = contentKey(remote);
    if (key === this.savedKey) return true;
    this.history.record($state.snapshot(this.doc) as Overlay, null);
    this.doc = clone(remote);
    this.savedKey = key;
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    if (this.selectedId && !this.layer(this.selectedId)) this.selectedId = null;
    return true;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
