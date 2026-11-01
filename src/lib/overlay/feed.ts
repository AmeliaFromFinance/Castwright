import type { OverlayMsg } from '$lib/bindings/OverlayMsg';

/** Live messages as they arrive, for parts that react to happenings rather than state (custom widgets). */
export interface OverlayFeed {
  subscribe(fn: (msg: OverlayMsg) => void): () => void;
}

export class Feed implements OverlayFeed {
  #subs = new Set<(msg: OverlayMsg) => void>();

  subscribe(fn: (msg: OverlayMsg) => void): () => void {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  }

  emit(msg: OverlayMsg): void {
    for (const fn of [...this.#subs]) {
      try {
        fn(msg);
      } catch (err) {
        console.error('[overlay] feed listener failed', err);
      }
    }
  }
}
