import { errorMessage } from '$lib/api/backend';
import { onFlush } from '$lib/state/flush';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Debounced saving of one value. `schedule` after each edit; `flush` when
 * leaving the page. Only the latest value is written.
 */
export class Autosaver<T> {
  status = $state<SaveStatus>('idle');
  error = $state<string | null>(null);

  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: T | null = null;
  #hasPending = false;
  #running: Promise<void> | null = null;

  constructor(
    private save: (value: T) => Promise<void>,
    private delay = 600
  ) {
    onFlush(() => this.flush());
  }

  get dirty(): boolean {
    return this.#hasPending || this.#running !== null;
  }

  schedule(value: T): void {
    this.#pending = value;
    this.#hasPending = true;
    this.status = 'pending';
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), this.delay);
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#running) await this.#running;
    if (!this.#hasPending) return;
    const value = this.#pending as T;
    this.#hasPending = false;
    this.#pending = null;
    this.status = 'saving';
    this.#running = this.save(value)
      .then(() => {
        if (!this.#hasPending) this.status = 'saved';
        this.error = null;
      })
      .catch((e: unknown) => {
        this.status = 'error';
        this.error = errorMessage(e);
      })
      .finally(() => {
        this.#running = null;
      });
    await this.#running;
  }

  /** Drop anything not yet written. */
  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#hasPending = false;
    this.#pending = null;
  }
}
