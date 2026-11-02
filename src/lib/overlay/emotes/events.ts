// 7TV EventAPI: live changes to the channel emote set.
// https://github.com/SevenTV/EventAPI

import type { SetWatcher } from './loader';

export const SEVENTV_EVENTS = 'wss://events.7tv.io/v3';

const OP = { dispatch: 0, hello: 1, heartbeat: 2, reconnect: 4, endOfStream: 7, subscribe: 35 } as const;

export interface EventsOptions {
  onSetUpdate: (body: unknown) => void;
  onUserUpdate: () => void;
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export class SevenTvEvents implements SetWatcher {
  #o: Required<Omit<EventsOptions, 'WebSocketImpl'>> & Pick<EventsOptions, 'WebSocketImpl'>;
  #ws: WebSocket | null = null;
  #setId: string | null = null;
  #userId: string | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #silence: ReturnType<typeof setTimeout> | null = null;
  #heartbeatMs = 45_000;
  #failures = 0;

  constructor(o: EventsOptions) {
    this.#o = { url: SEVENTV_EVENTS, minBackoffMs: 5_000, maxBackoffMs: 300_000, ...o };
  }

  watch(setId: string | null, userId: string | null): void {
    if (setId === this.#setId && userId === this.#userId) return;
    this.#setId = setId;
    this.#userId = userId;
    this.#close();
    if (setId) this.#connect();
  }

  #connect(): void {
    const Impl = this.#o.WebSocketImpl ?? globalThis.WebSocket;
    if (!Impl) return;
    let ws: WebSocket;
    try {
      ws = new Impl(this.#o.url);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;
    ws.onmessage = (m) => this.#onMessage(String(m.data));
    ws.onclose = () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#scheduleRetry();
    };
    ws.onerror = () => {};
  }

  #close(): void {
    if (this.#retry) clearTimeout(this.#retry);
    if (this.#silence) clearTimeout(this.#silence);
    this.#retry = this.#silence = null;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    }
  }

  #scheduleRetry(): void {
    this.#close();
    if (!this.#setId) return;
    const wait = Math.min(this.#o.maxBackoffMs, this.#o.minBackoffMs * 2 ** Math.min(this.#failures++, 10));
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.#connect();
    }, wait);
  }

  /** Reconnects when 7TV goes quiet for three heartbeats. */
  #alive(): void {
    if (this.#silence) clearTimeout(this.#silence);
    this.#silence = setTimeout(() => this.#scheduleRetry(), this.#heartbeatMs * 3);
  }

  #send(op: number, d: unknown): void {
    this.#ws?.send(JSON.stringify({ op, d }));
  }

  #onMessage(text: string): void {
    let msg: { op?: number; d?: Record<string, unknown> };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const d = msg.d ?? {};
    switch (msg.op) {
      case OP.hello:
        this.#failures = 0;
        if (typeof d.heartbeat_interval === 'number' && d.heartbeat_interval > 0) this.#heartbeatMs = d.heartbeat_interval;
        this.#alive();
        if (this.#setId) this.#send(OP.subscribe, { type: 'emote_set.update', condition: { object_id: this.#setId } });
        if (this.#userId) this.#send(OP.subscribe, { type: 'user.update', condition: { object_id: this.#userId } });
        break;
      case OP.heartbeat:
        this.#alive();
        break;
      case OP.dispatch:
        this.#alive();
        if (d.type === 'emote_set.update') this.#o.onSetUpdate(d.body);
        else if (d.type === 'user.update') this.#o.onUserUpdate();
        break;
      case OP.reconnect:
        this.#failures = 0;
        this.#close();
        this.#connect();
        break;
      case OP.endOfStream:
        this.#scheduleRetry();
        break;
    }
  }
}
