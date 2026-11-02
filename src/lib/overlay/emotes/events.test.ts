import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SevenTvEvents } from './events';

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  closed = false;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(t: string) {
    this.sent.push(JSON.parse(t));
  }
  close() {
    this.closed = true;
  }
  recv(op: number, d: unknown) {
    this.onmessage?.({ data: JSON.stringify({ op, d }) });
  }
}

describe('SevenTvEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });
  afterEach(() => vi.useRealTimers());

  function make() {
    const onSetUpdate = vi.fn();
    const onUserUpdate = vi.fn();
    const ev = new SevenTvEvents({ onSetUpdate, onUserUpdate, WebSocketImpl: FakeSocket as unknown as typeof WebSocket, minBackoffMs: 1000, maxBackoffMs: 8000 });
    return { ev, onSetUpdate, onUserUpdate };
  }

  it('subscribes after hello and passes on set changes', () => {
    const { ev, onSetUpdate, onUserUpdate } = make();
    ev.watch('set1', 'user1');
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe('wss://events.7tv.io/v3');
    ws.recv(1, { heartbeat_interval: 1000, session_id: 's' });
    expect(ws.sent).toEqual([
      { op: 35, d: { type: 'emote_set.update', condition: { object_id: 'set1' } } },
      { op: 35, d: { type: 'user.update', condition: { object_id: 'user1' } } }
    ]);
    ws.recv(0, { type: 'emote_set.update', body: { id: 'set1', pushed: [] } });
    expect(onSetUpdate).toHaveBeenCalledWith({ id: 'set1', pushed: [] });
    ws.recv(0, { type: 'user.update', body: {} });
    expect(onUserUpdate).toHaveBeenCalledTimes(1);
  });

  it('reconnects with backoff after a drop and when 7TV goes quiet', () => {
    const { ev } = make();
    ev.watch('set1', null);
    FakeSocket.all[0]!.onclose?.();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    const ws = FakeSocket.all[1]!;
    ws.recv(1, { heartbeat_interval: 1000 });
    vi.advanceTimersByTime(2500);
    ws.recv(2, {});
    vi.advanceTimersByTime(2500);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(500);
    expect(ws.closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it('moves to a new set and stops when cleared', () => {
    const { ev } = make();
    ev.watch('set1', null);
    ev.watch('set1', null);
    expect(FakeSocket.all).toHaveLength(1);
    ev.watch('set2', null);
    expect(FakeSocket.all[0]!.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(2);
    ev.watch(null, null);
    expect(FakeSocket.all[1]!.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('follows a reconnect request right away', () => {
    const { ev } = make();
    ev.watch('set1', null);
    FakeSocket.all[0]!.recv(4, {});
    expect(FakeSocket.all).toHaveLength(2);
  });
});
