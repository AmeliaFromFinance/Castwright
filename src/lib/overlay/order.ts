// Order and direction for list layers.
import type { ListStack } from '$lib/bindings/ListStack';

export type Edge = 'top' | 'bottom';

/** `newestFirst` lists shown newest at the top, or flipped so the newest is at the bottom. */
export function ordered<T>(newestFirst: readonly T[], newestOnTop: boolean): T[] {
  return newestOnTop ? newestFirst.slice() : newestFirst.slice().reverse();
}

/** The edge new items come in at. */
export const newEdge = (newestOnTop: boolean): Edge => (newestOnTop ? 'top' : 'bottom');

/** The edge the list sits against. Auto follows the order. */
export function stackEdge(newestOnTop: boolean, stack: ListStack | undefined): Edge {
  return stack === 'top' || stack === 'bottom' ? stack : newEdge(newestOnTop);
}

/** Entry slide offset in px: new items come in from the edge they appear at. */
export const enterY = (edge: Edge, px: number): number => (edge === 'top' ? -px : px);

/** Ticker translateX for an offset of 0 to `width` px: left moves towards -width, right towards 0. */
export function tickerX(offset: number, width: number, right: boolean): number {
  const o = width > 0 ? ((offset % width) + width) % width : 0;
  return right ? o - width : -o;
}

/** Copies of the ticker items needed to fill the view without a gap. */
export function tickerCopies(view: number, width: number, right: boolean): number {
  if (width <= 0) return 1;
  return Math.max(2, Math.ceil(view / width) + (right ? 2 : 1));
}
