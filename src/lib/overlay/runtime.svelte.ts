import type { OverlayClientMsg } from '$lib/bindings/OverlayClientMsg';
import type { OverlayMsg } from '$lib/bindings/OverlayMsg';
import { assetResolver } from './assets';
import { backoffDelay, type Endpoint } from './connection';
import { Feed } from './feed';
import { emptyState, parseMsg, reduce, setWidgetValue, type OverlayState } from './state';

export interface RuntimeOptions {
  endpoint: Endpoint;
  /** For tests. */
  WebSocketImpl?: typeof WebSocket;
  /** Called for `reload`. Defaults to `location.reload()`. */
  onReload?: () => void;
  /** Called for `play_sound` with a resolved URL and 0-1 volume. */
  playSound?: (url: string, volume: number) => void;
}

const PING_MS = 25_000;

function defaultPlaySound(url: string, volume: number): void {
  try {
    const a = new Audio(url);
    a.volume = volume;
    a.play().catch((err: unknown) => console.warn('[overlay] sound blocked or failed', err));
  } catch (err) {
    console.warn('[overlay] sound failed', err);
  }
}

/** Live overlay state fed by the Castwright WebSocket. Reconnects forever. */
export class OverlayRuntime {
  state = $state.raw<OverlayState>(emptyState());
  connected = $state(false);
  readonly feed = new Feed();
  readonly assetUrl: (path: string) => string;

  #opts: RuntimeOptions;
  #ws: WebSocket | null = null;
  #attempt = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #ping: ReturnType<typeof setInterval> | null = null;
  #stopped = true;
  /** Widget writes not yet confirmed by a hello; re-sent after reconnecting. */
  #unsent: OverlayClientMsg[] = [];

  constructor(opts: RuntimeOptions) {
    this.#opts = opts;
    this.assetUrl = assetResolver(opts.endpoint.httpBase, opts.endpoint.token, opts.endpoint.assetKey);
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    this.#clearPing();
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.connected = false;
  }

  /** Apply a server message (also used by tests and the editor). */
  dispatch(raw: unknown): void {
    const msg = parseMsg(raw);
    if (!msg) {
      console.warn('[overlay] ignored malformed message');
      return;
    }
    this.#apply(msg);
  }

  /** Save (or with `undefined`, delete) a custom widget value. */
  storeWidgetValue = (layerId: string, key: string, value: unknown): void => {
    this.state = setWidgetValue(this.state, layerId, key, value);
    const msg: OverlayClientMsg =
      value === undefined ? { type: 'store_delete', layer_id: layerId, key } : { type: 'store_set', layer_id: layerId, key, value };
    this.#unsent = this.#unsent.filter((m) => !('key' in m && m.layer_id === layerId && m.key === key));
    this.#unsent.push(msg);
    if (this.#unsent.length > 500) this.#unsent.shift();
    if (this.#send(msg)) this.#unsent = this.#unsent.filter((m) => m !== msg);
  };

  #apply(msg: OverlayMsg): void {
    switch (msg.type) {
      case 'reload':
        (this.#opts.onReload ?? (() => location.reload()))();
        return;
      case 'play_sound': {
        // Sounds play from overlays that show alerts, so a scene with several
        // Castwright overlays doesn't play the same sound more than once.
        const hasAlerts = this.state.overlay?.layers.some((l) => l.kind.type === 'alerts' && l.visible) ?? false;
        const url = this.assetUrl(msg.src ?? '');
        if (url && hasAlerts) (this.#opts.playSound ?? defaultPlaySound)(url, Math.min(1, Math.max(0, (msg.volume ?? 100) / 100)));
        break;
      }
      case 'hello': {
        this.#attempt = 0;
        let next = reduce(this.state, msg);
        // Writes the server may not have seen yet win over its snapshot.
        for (const m of this.#unsent) {
          if (m.type === 'store_set') next = setWidgetValue(next, m.layer_id, m.key, m.value);
          else if (m.type === 'store_delete') next = setWidgetValue(next, m.layer_id, m.key, undefined);
        }
        this.state = next;
        const pending = this.#unsent;
        this.#unsent = [];
        for (const m of pending) if (!this.#send(m)) this.#unsent.push(m);
        this.feed.emit(msg);
        return;
      }
    }
    this.state = reduce(this.state, msg);
    this.feed.emit(msg);
  }

  #send(msg: OverlayClientMsg): boolean {
    const ws = this.#ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  #connect(): void {
    if (this.#stopped) return;
    const Impl = this.#opts.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new Impl(this.#opts.endpoint.wsUrl);
    } catch (err) {
      console.warn('[overlay] could not open connection', err);
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.connected = true;
      this.#clearPing();
      this.#ping = setInterval(() => this.#send({ type: 'ping' }), PING_MS);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.#ws !== ws) return;
      if (typeof e.data !== 'string') return;
      try {
        this.dispatch(e.data);
      } catch (err) {
        console.error('[overlay] failed to apply message', err);
      }
    };
    ws.onerror = () => {
      // onclose follows and handles the retry.
    };
    ws.onclose = (e: CloseEvent) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.connected = false;
      this.#clearPing();
      if (!this.#stopped) {
        console.warn(`[overlay] disconnected (${e.code}), retrying in ${backoffDelay(this.#attempt)}ms`);
        this.#scheduleReconnect();
      }
    };
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#retry) return;
    const delay = backoffDelay(this.#attempt);
    this.#attempt++;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.#connect();
    }, delay);
  }

  #clearPing(): void {
    if (this.#ping) clearInterval(this.#ping);
    this.#ping = null;
  }
}
