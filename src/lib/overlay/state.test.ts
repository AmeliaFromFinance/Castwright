import { describe, expect, it } from 'vitest';
import type { Overlay } from '$lib/bindings/Overlay';
import type { OverlayMsg } from '$lib/bindings/OverlayMsg';
import { CHAT_KEEP, emptyState, parseMsg, reduce, RECENT_KEEP, setWidgetValue } from './state';
import { alertPlay, ev, layer } from './test/fixtures';
import { defaultChatRules } from './chat-filters';

const overlay = (id = 'o1'): Overlay => ({
  id,
  name: 'HUD',
  width: 1920,
  height: 1080,
  layers: [layer({ type: 'alerts' })],
  fonts: ['Inter'],
  updated_at: 1
});

function hello(): OverlayMsg {
  return {
    type: 'hello',
    overlay: overlay(),
    vars: { 'session.subs': 3 },
    recent: [ev('follow'), ev('chat')],
    chat: [ev('chat', { user: { id: 'u1', login: 'a', display_name: 'A' } }), ev('chat', { user: { id: 'u2', login: 'b', display_name: 'B' } })],
    widget_state: { l1: { count: 4 } },
    chat_rules: defaultChatRules()
  };
}

describe('reduce', () => {
  it('hello replaces everything but a running alert', () => {
    const playing = reduce(emptyState(), { type: 'alert_play', play: alertPlay() }, 10);
    const dirty = { ...playing, vars: { old: 1 }, visibility: { x: false }, chat: [ev('chat')] };
    const s = reduce(dirty, hello());
    expect(s.overlay?.id).toBe('o1');
    expect(s.vars).toEqual({ 'session.subs': 3 });
    expect(s.recent.map((e) => e.kind)).toEqual(['follow']);
    expect(s.chat).toHaveLength(2);
    expect(s.widgetState).toEqual({ l1: { count: 4 } });
    expect(s.visibility).toEqual({});
    expect(s.alert).toBe(playing.alert);
  });

  it('overlay swaps the layout and drops visibility overrides', () => {
    const s0 = reduce(reduce(emptyState(), hello()), { type: 'layer_visible', layer_id: 'x', visible: false });
    const s = reduce(s0, { type: 'overlay', overlay: overlay('o2') });
    expect(s.overlay?.id).toBe('o2');
    expect(s.visibility).toEqual({});
    expect(s.vars).toBe(s0.vars);
  });

  it('vars merges and deletes nulls', () => {
    const s0 = { ...emptyState(), vars: { a: 1, b: 2 } };
    const s = reduce(s0, { type: 'vars', changes: { a: 5, b: null, c: 'x' } });
    expect(s.vars).toEqual({ a: 5, c: 'x' });
    expect(s0.vars).toEqual({ a: 1, b: 2 });
  });

  it('event routes chat and other events, dedupes and caps', () => {
    let s = emptyState();
    const c = ev('chat');
    s = reduce(s, { type: 'event', event: c });
    s = reduce(s, { type: 'event', event: c });
    s = reduce(s, { type: 'event', event: ev('raid') });
    expect(s.chat).toHaveLength(1);
    expect(s.recent).toHaveLength(1);
    for (let i = 0; i < CHAT_KEEP + 5; i++) s = reduce(s, { type: 'event', event: ev('chat') });
    for (let i = 0; i < RECENT_KEEP + 5; i++) s = reduce(s, { type: 'event', event: ev('follow') });
    expect(s.chat).toHaveLength(CHAT_KEEP);
    expect(s.recent).toHaveLength(RECENT_KEEP);
    expect(s.recent[0]?.kind).toBe('follow');
  });

  it('chat_delete, chat_clear_user and chat_clear', () => {
    const s0 = reduce(emptyState(), hello());
    const first = s0.chat[0]!;
    expect(reduce(s0, { type: 'chat_delete', message_id: first.id }).chat.map((c) => c.id)).toEqual([s0.chat[1]!.id]);
    expect(reduce(s0, { type: 'chat_delete', message_id: 'nope' })).toBe(s0);
    expect(reduce(s0, { type: 'chat_clear_user', user_id: 'u2' }).chat.map((c) => c.user?.id)).toEqual(['u1']);
    expect(reduce(s0, { type: 'chat_clear' }).chat).toEqual([]);
  });

  it('alert_play replaces, alert_stop marks only the current alert', () => {
    const a = alertPlay();
    const b = alertPlay();
    let s = reduce(emptyState(), { type: 'alert_play', play: a }, 100);
    expect(s.alert).toEqual({ play: a, startedAt: 100, stoppedAt: null });
    s = reduce(s, { type: 'alert_play', play: b }, 200);
    expect(s.alert?.play.id).toBe(b.id);
    expect(reduce(s, { type: 'alert_stop', id: a.id }, 300)).toBe(s);
    const stopped = reduce(s, { type: 'alert_stop', id: b.id }, 300);
    expect(stopped.alert?.stoppedAt).toBe(300);
    expect(reduce(stopped, { type: 'alert_stop', id: b.id }, 400).alert?.stoppedAt).toBe(300);
  });

  it('layer_visible sets an override', () => {
    const s = reduce(emptyState(), { type: 'layer_visible', layer_id: 'l9', visible: false });
    expect(s.visibility).toEqual({ l9: false });
  });

  it('chat rules come with hello and when they change', () => {
    const s = reduce(emptyState(), hello());
    expect(s.chatRules?.hide_bots).toBe(true);
    const next = reduce(s, { type: 'chat_rules', rules: { ...defaultChatRules(), hide_words: ['spoiler'] } });
    expect(next.chatRules?.hide_words).toEqual(['spoiler']);
    const old = { ...hello(), chat_rules: undefined } as unknown as OverlayMsg;
    expect(reduce(next, old).chatRules?.hide_words, 'an older app keeps the last rules').toEqual(['spoiler']);
  });

  it('play_sound, reload and unknown types leave state alone', () => {
    const s0 = reduce(emptyState(), hello());
    expect(reduce(s0, { type: 'play_sound', src: 'a.mp3', volume: 50 })).toBe(s0);
    expect(reduce(s0, { type: 'reload' })).toBe(s0);
    expect(reduce(s0, { type: 'mystery' } as unknown as OverlayMsg)).toBe(s0);
  });
});

describe('parseMsg', () => {
  it('parses JSON and rejects junk', () => {
    expect(parseMsg('{"type":"chat_clear"}')).toEqual({ type: 'chat_clear' });
    expect(parseMsg('not json')).toBeNull();
    expect(parseMsg('[1]')).toBeNull();
    expect(parseMsg({ nope: 1 })).toBeNull();
  });
});

describe('setWidgetValue', () => {
  it('sets and deletes per layer', () => {
    let s = setWidgetValue(emptyState(), 'l1', 'a', 1);
    s = setWidgetValue(s, 'l1', 'b', { x: 1 });
    expect(s.widgetState).toEqual({ l1: { a: 1, b: { x: 1 } } });
    s = setWidgetValue(s, 'l1', 'a', undefined);
    expect(s.widgetState).toEqual({ l1: { b: { x: 1 } } });
  });
});
