export interface Inserted {
  text: string;
  /** Caret position after the token. */
  caret: number;
}

/** Replace the selection `start..end` in `text` with `{{token}}`. */
export function insertToken(text: string, start: number | null, end: number | null, token: string): Inserted {
  const snippet = `{{${token}}}`;
  const len = text.length;
  const a = Math.max(0, Math.min(start ?? len, len));
  const b = Math.max(a, Math.min(end ?? a, len));
  return { text: text.slice(0, a) + snippet + text.slice(b), caret: a + snippet.length };
}

export interface Token {
  token: string;
  label?: string;
}
