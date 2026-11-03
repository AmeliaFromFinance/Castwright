import { errorMessage } from '$lib/api/backend';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  key?: string;
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

class Toasts {
  items = $state<Toast[]>([]);
  private next = 1;

  /** A toast with the same `key` replaces the previous one. */
  show(message: string, kind: ToastKind = 'info', ms = 4000, key?: string, action?: ToastAction) {
    const id = this.next++;
    if (key) this.items = this.items.filter((t) => t.key !== key);
    this.items.push({ id, kind, message, key, action });
    if (this.items.length > 4) this.items.shift();
    setTimeout(() => this.dismiss(id), kind === 'error' ? Math.max(ms, 7000) : ms);
  }

  success(message: string) {
    this.show(message, 'success');
  }

  error(e: unknown) {
    this.show(errorMessage(e), 'error');
  }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();

/** Run `fn`; show its error as a toast instead of throwing. Returns undefined on error. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (success) toasts.success(success);
    return r;
  } catch (e) {
    toasts.error(e);
    return undefined;
  }
}

/** Like `attempt`, for calls that return nothing: true when it worked. */
export async function attemptOk(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn();
    if (success) toasts.success(success);
    return true;
  } catch (e) {
    toasts.error(e);
    return false;
  }
}
