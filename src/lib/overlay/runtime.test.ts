import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLocation } from './connection';
import { OverlayRuntime } from './runtime.svelte';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const endpoint = parseLocation({ protocol: 'http:', host: '127.0.0.1:7474', pathname: '/overlay/o1', search: '?token=t' });
const hello = { type: 'hello', overlay: { id: 'o1', name: '', width: 1920, height: 1080, layers: [], fonts: [], updated_at: 0 }, vars: {}, recent: [], chat: [], widget_state: { l1: { a: 1 } } };

function make(extra: Partial<ConstructorParameters<typeof OverlayRuntime>[0]> = {}) {
  return new OverlayRuntime({ endpoint, WebSocketImpl: FakeSocket as unknown as typeof WebSocket, ...extra });
}

describe('OverlayRuntime', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects to the ws URL and applies hello', () => {
    const rt = make();
    rt.start();
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe('ws://127.0.0.1:7474/ws?token=t&overlay=o1');
    ws.open();
    ws.receive(hello);
    expect(rt.connected).toBe(true);
    expect(rt.state.overlay?.id).toBe('o1');
    rt.stop();
  });

  it('reconnects with 0.5s, 1s, 2s, 5s backoff and resets after hello', () => {
    const rt = make();
    rt.start();
    const delays = [500, 1000, 2000, 5000, 5000];
    for (const d of delays) {
      const before = FakeSocket.all.length;
      FakeSocket.all.at(-1)!.drop();
      vi.advanceTimersByTime(d - 1);
      expect(FakeSocket.all.length).toBe(before);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.all.length).toBe(before + 1);
    }
    const ws = FakeSocket.all.at(-1)!;
    ws.open();
    ws.receive(hello);
    const n = FakeSocket.all.length;
    ws.drop();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all.length).toBe(n + 1);
    rt.stop();
  });

  it('keeps the last state while disconnected', () => {
    const rt = make();
    rt.start();
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.receive(hello);
    ws.drop();
    expect(rt.connected).toBe(false);
    expect(rt.state.overlay?.id).toBe('o1');
    rt.stop();
  });

  it('sends widget store writes and replays unsent ones after reconnecting', () => {
    const rt = make();
    rt.start();
    let ws = FakeSocket.all[0]!;
    ws.open();
    ws.receive(hello);
    rt.storeWidgetValue('l1', 'k', { n: 1 });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ type: 'store_set', layer_id: 'l1', key: 'k', value: { n: 1 } });
    rt.storeWidgetValue('l1', 'a', undefined);
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ type: 'store_delete', layer_id: 'l1', key: 'a' });

    ws.drop();
    rt.storeWidgetValue('l1', 'offline', 2);
    expect(rt.state.widgetState.l1).toEqual({ k: { n: 1 }, offline: 2 });
    vi.advanceTimersByTime(500);
    ws = FakeSocket.all.at(-1)!;
    ws.open();
    ws.receive(hello);
    expect(rt.state.widgetState.l1).toEqual({ a: 1, offline: 2 });
    expect(ws.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'store_set', layer_id: 'l1', key: 'offline', value: 2 });
    rt.stop();
  });

  it('plays sounds, reloads and feeds messages', () => {
    const playSound = vi.fn();
    const onReload = vi.fn();
    const rt = make({ playSound, onReload });
    const seen: string[] = [];
    rt.feed.subscribe((m) => seen.push(m.type));
    // Overlays without an alerts layer stay quiet.
    rt.dispatch(hello as never);
    rt.dispatch({ type: 'play_sound', src: 'assets/ding.mp3', volume: 40 });
    expect(playSound).not.toHaveBeenCalled();
    const withAlerts = {
      ...hello,
      overlay: { ...hello.overlay, layers: [{ id: 'a', name: 'Alerts', kind: { type: 'alerts' } }] }
    };
    rt.dispatch(withAlerts as never);
    rt.dispatch({ type: 'play_sound', src: 'assets/ding.mp3', volume: 40 });
    expect(playSound).toHaveBeenCalledWith('http://127.0.0.1:7474/assets/ding.mp3?token=t', 0.4);
    rt.dispatch({ type: 'reload' });
    expect(onReload).toHaveBeenCalledOnce();
    rt.dispatch({ type: 'chat_clear' });
    expect(seen).toEqual(['hello', 'play_sound', 'hello', 'play_sound', 'chat_clear']);
  });

  it('pings while connected', () => {
    const rt = make();
    rt.start();
    const ws = FakeSocket.all[0]!;
    ws.open();
    vi.advanceTimersByTime(25_000);
    expect(ws.sent).toContain('{"type":"ping"}');
    rt.stop();
  });
});
