// Soundboard sounds in the app window: plays "Only me" and "Both" sounds here and
// tracks every sound that's playing, so buttons can show progress and stop it.
import { api, on } from '$lib/api';
import type { PlayOutcome } from '$lib/bindings/PlayOutcome';
import type { SoundCue } from '$lib/bindings/SoundCue';
import type { SoundboardStatus } from '$lib/bindings/SoundboardStatus';
import { app } from '$lib/state/app.svelte';
import { attempt, toasts } from '$lib/state/toast.svelte';
import { appAssetUrl } from '$lib/widgets/assets.svelte';

export interface Playing {
  playId: number;
  label: string;
  startedAt: number;
  /** Null until the file's length is known. */
  durationMs: number | null;
  local: boolean;
  stream: boolean;
}

/** Give up on a sound whose length can't be read after this long. */
const UNKNOWN_MS = 15_000;

/** What a play request that didn't play means, in words. */
export function outcomeMessage(o: PlayOutcome): string | null {
  switch (o.result) {
    case 'played':
      return null;
    case 'muted':
      return 'The soundboard is muted. Unmute it in the soundboard header.';
    case 'cooldown':
      return `On cooldown for ${o.seconds_left} more second${o.seconds_left === 1 ? '' : 's'}.`;
    case 'no_file':
      return 'Pick a sound file for this button first.';
    case 'not_found':
      return 'That sound no longer exists.';
  }
}

class SoundPlayer {
  status = $state<SoundboardStatus | null>(null);
  playing = $state<Record<string, Playing>>({});

  #audio = new Map<string, HTMLAudioElement>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #started = false;

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.status = await api.soundboardStatus().catch(() => null);
    await on('cw://soundboard', (s) => (this.status = s));
    await on('cw://sound', (c) => this.#cue(c));
  }

  isPlaying(id: string): boolean {
    return id in this.playing;
  }

  async play(id: string): Promise<void> {
    const out = await attempt(() => api.soundPlay(id));
    const msg = out && outcomeMessage(out);
    if (msg) toasts.show(msg, 'info', 3000, 'soundboard');
  }

  /** Click: play, or stop it when it's playing. */
  async toggle(id: string): Promise<void> {
    if (this.isPlaying(id)) await attempt(() => api.soundStop(id));
    else await this.play(id);
  }

  async stopAll(): Promise<void> {
    await attempt(() => api.soundStop(null));
  }

  async setMuted(muted: boolean): Promise<void> {
    const s = await attempt(() => api.soundboardMute(muted));
    if (s) this.status = s;
  }

  #cue(c: SoundCue): void {
    if (c.type === 'stop') {
      if (c.sound_id === null) for (const id of Object.keys(this.playing)) this.#end(id);
      else this.#end(c.sound_id);
      return;
    }
    const id = c.sound_id;
    this.#end(id);
    this.playing = {
      ...this.playing,
      [id]: { playId: c.play_id, label: c.label, startedAt: Date.now(), durationMs: null, local: c.local, stream: c.stream }
    };
    const url = appAssetUrl(c.src, app.server?.base_url, app.server?.asset_key);
    const done = () => this.#finish(id, c.play_id);
    this.#timers.set(id, setTimeout(done, UNKNOWN_MS));
    if (!url || typeof Audio === 'undefined') return;
    const audio = new Audio();
    audio.preload = c.local ? 'auto' : 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      const p = this.playing[id];
      if (!p || p.playId !== c.play_id || !Number.isFinite(audio.duration)) return;
      const durationMs = Math.round(audio.duration * 1000);
      this.playing = { ...this.playing, [id]: { ...p, durationMs } };
      // Stream-only sounds play in OBS; end the indicator when they would.
      clearTimeout(this.#timers.get(id));
      this.#timers.set(id, setTimeout(done, Math.max(0, p.startedAt + durationMs + (c.local ? 1500 : 0) - Date.now())));
    });
    if (c.local) {
      audio.addEventListener('ended', done);
      audio.volume = Math.min(1, Math.max(0, c.volume / 100));
    }
    audio.src = url;
    this.#audio.set(id, audio);
    if (c.local) audio.play().catch((err: unknown) => console.warn('[soundboard] sound blocked or failed', err));
  }

  #finish(id: string, playId: number): void {
    if (this.playing[id]?.playId === playId) this.#end(id);
  }

  #end(id: string): void {
    const audio = this.#audio.get(id);
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      this.#audio.delete(id);
    }
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    if (id in this.playing) {
      const next = { ...this.playing };
      delete next[id];
      this.playing = next;
    }
  }
}

export const sounds = new SoundPlayer();
