const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 12 random characters, same shape as the backend's ids. */
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
