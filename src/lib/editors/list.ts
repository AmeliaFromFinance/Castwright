/** Copy of `items` with the item at `i` moved by `by` places. Out of range = unchanged copy. */
export function moveItem<T>(items: readonly T[], i: number, by: number): T[] {
  const out = [...items];
  const j = i + by;
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  const [it] = out.splice(i, 1);
  out.splice(j, 0, it as T);
  return out;
}

export function insertItem<T>(items: readonly T[], i: number, item: T): T[] {
  const out = [...items];
  out.splice(Math.max(0, Math.min(i, out.length)), 0, item);
  return out;
}

export function removeItem<T>(items: readonly T[], i: number): T[] {
  return items.filter((_, j) => j !== i);
}

export function replaceItem<T>(items: readonly T[], i: number, item: T): T[] {
  return items.map((x, j) => (j === i ? item : x));
}

/** "Name copy", "Name copy 2"... not clashing with `taken`. */
export function copyName(name: string, taken: readonly string[]): string {
  const base = `${name.replace(/ copy( \d+)?$/, '')} copy`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
}
