export type Unlisten = () => void;

export interface Backend {
  readonly kind: 'tauri' | 'demo';
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, cb: (payload: T) => void): Promise<Unlisten>;
}

/** Error shape returned by Rust commands. */
export interface AppError {
  code: string;
  message: string;
}

export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as AppError).message === 'string') {
    return (e as AppError).message;
  }
  return 'Something went wrong.';
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
