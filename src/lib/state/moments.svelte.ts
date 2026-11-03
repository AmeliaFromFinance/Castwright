import { api, on } from '$lib/api';
import type { MarkerEntry } from '$lib/bindings/MarkerEntry';
import type { MomentEvent } from '$lib/bindings/MomentEvent';
import { toasts } from './toast.svelte';

/** How long a marker toast waits for a note. */
export const NOTE_MS = 10_000;
const CLIP_MS = 30_000;

export type MomentToast =
  | { kind: 'marker'; key: string; marker: MarkerEntry }
  | { kind: 'clip'; key: string; id: string; status: 'making' | 'ready' | 'slow'; url: string; title: string };

class Moments {
  items = $state<MomentToast[]>([]);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listening = false;

  async listen() {
    if (this.listening) return;
    this.listening = true;
    await on('cw://moment', (e) => this.handle(e));
  }

  handle(e: MomentEvent) {
    switch (e.type) {
      case 'marker': {
        const key = `marker-${e.marker.id || e.marker.ts}`;
        this.items.push({ kind: 'marker', key, marker: e.marker });
        this.later(key, NOTE_MS);
        break;
      }
      case 'clip_started':
        this.items.push({ kind: 'clip', key: `clip-${e.id}`, id: e.id, status: 'making', url: '', title: '' });
        break;
      case 'clip_ready':
      case 'clip_slow': {
        const id = e.type === 'clip_ready' ? e.clip.id : e.id;
        const item = this.items.find((i) => i.kind === 'clip' && i.id === id);
        const next = {
          kind: 'clip' as const,
          key: `clip-${id}`,
          id,
          status: e.type === 'clip_ready' ? ('ready' as const) : ('slow' as const),
          url: e.type === 'clip_ready' ? e.clip.url : e.url,
          title: e.type === 'clip_ready' ? e.clip.title : ''
        };
        if (item) Object.assign(item, next);
        else this.items.push(next);
        this.later(next.key, CLIP_MS);
        break;
      }
      case 'failed':
        toasts.show(e.message, 'error');
        break;
    }
    if (this.items.length > 4) this.dismiss(this.items[0]!.key);
  }

  /** Close the toast after `ms`, unless `hold` is called first. */
  later(key: string, ms: number) {
    this.hold(key);
    this.timers.set(
      key,
      setTimeout(() => this.dismiss(key), ms)
    );
  }

  hold(key: string) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  dismiss(key: string) {
    this.hold(key);
    this.items = this.items.filter((i) => i.key !== key);
  }

  /** Twitch can't change a marker, so the note is kept by Castwright only. */
  async saveNote(key: string, id: string, note: string): Promise<boolean> {
    try {
      await api.markerNote(id, note);
      this.dismiss(key);
      toasts.success(note.trim() ? 'Note saved' : 'Note removed');
      return true;
    } catch (e) {
      toasts.error(e);
      return false;
    }
  }
}

export const moments = new Moments();
