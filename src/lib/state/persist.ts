/** Small UI preferences kept per device (panel sizes, open sections). */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`cw.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`cw.${key}`, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; preferences are optional.
  }
}
