/** Things with unsaved edits register here so closing the window can save them first. */
const flushers = new Set<() => Promise<unknown>>();

export function onFlush(fn: () => Promise<unknown>): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/** Save everything pending. Never throws; gives up after `timeoutMs`. */
export async function flushAll(timeoutMs = 4000): Promise<void> {
  const all = Promise.allSettled([...flushers].map((f) => f()));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}
