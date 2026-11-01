import type { AlertPlay } from '$lib/bindings/AlertPlay';
import type { Event } from '$lib/bindings/Event';
import type { Overlay } from '$lib/bindings/Overlay';
import type { OverlayMsg } from '$lib/bindings/OverlayMsg';

export const CHAT_KEEP = 200;
export const RECENT_KEEP = 50;

export interface ActiveAlert {
  play: AlertPlay;
  /** When it arrived (ms, Date.now clock). */
  startedAt: number;
  /** Set by `alert_stop`: the exit animation starts at this time. */
  stoppedAt: number | null;
}

export type WidgetState = Record<string, Record<string, unknown>>;

export interface OverlayState {
  overlay: Overlay | null;
  vars: Record<string, unknown>;
  /** Non-chat events, oldest first. */
  recent: Event[];
  /** Chat messages, oldest first. */
  chat: Event[];
  widgetState: WidgetState;
  alert: ActiveAlert | null;
  /** `layer_visible` overrides until the next layout update. */
  visibility: Record<string, boolean>;
}

export function emptyState(): OverlayState {
  return { overlay: null, vars: {}, recent: [], chat: [], widgetState: {}, alert: null, visibility: {} };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Basic shape check for data from the socket. Returns null for anything unusable. */
export function parseMsg(raw: unknown): OverlayMsg | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || typeof v.type !== 'string') return null;
  return v as OverlayMsg;
}

function pushCapped(list: Event[], e: Event, cap: number): Event[] {
  if (list.some((x) => x.id === e.id)) return list;
  const next = list.length >= cap ? list.slice(list.length - cap + 1) : list.slice();
  next.push(e);
  return next;
}

function tail<T>(list: readonly T[] | null | undefined, cap: number): T[] {
  const l = Array.isArray(list) ? list : [];
  return l.length > cap ? l.slice(l.length - cap) : l.slice();
}

/** Applies one server message. Pure: returns a new state, sharing what didn't change. */
export function reduce(state: OverlayState, msg: OverlayMsg, now: number = Date.now()): OverlayState {
  switch (msg.type) {
    case 'hello': {
      const recent = (Array.isArray(msg.recent) ? msg.recent : []).filter((e) => e && e.kind !== 'chat');
      // The current alert isn't part of hello, so keep it running across reconnects.
      return {
        overlay: msg.overlay ?? null,
        vars: isObj(msg.vars) ? { ...msg.vars } : {},
        recent: tail(recent, RECENT_KEEP),
        chat: tail(msg.chat, CHAT_KEEP),
        widgetState: isObj(msg.widget_state) ? (msg.widget_state as WidgetState) : {},
        alert: state.alert,
        visibility: {}
      };
    }
    case 'overlay':
      return msg.overlay ? { ...state, overlay: msg.overlay, visibility: {} } : state;
    case 'vars': {
      if (!isObj(msg.changes)) return state;
      const vars = { ...state.vars };
      for (const [k, v] of Object.entries(msg.changes)) {
        if (v === null || v === undefined) delete vars[k];
        else vars[k] = v;
      }
      return { ...state, vars };
    }
    case 'event': {
      const e = msg.event;
      if (!e || typeof e.id !== 'string') return state;
      if (e.kind === 'chat') {
        const chat = pushCapped(state.chat, e, CHAT_KEEP);
        return chat === state.chat ? state : { ...state, chat };
      }
      const recent = pushCapped(state.recent, e, RECENT_KEEP);
      return recent === state.recent ? state : { ...state, recent };
    }
    case 'chat_delete': {
      const chat = state.chat.filter((c) => c.id !== msg.message_id);
      return chat.length === state.chat.length ? state : { ...state, chat };
    }
    case 'chat_clear_user': {
      const chat = state.chat.filter((c) => c.user?.id !== msg.user_id);
      return chat.length === state.chat.length ? state : { ...state, chat };
    }
    case 'chat_clear':
      return state.chat.length ? { ...state, chat: [] } : state;
    case 'alert_play':
      return msg.play ? { ...state, alert: { play: msg.play, startedAt: now, stoppedAt: null } } : state;
    case 'alert_stop':
      if (!state.alert || state.alert.play.id !== msg.id || state.alert.stoppedAt !== null) return state;
      return { ...state, alert: { ...state.alert, stoppedAt: now } };
    case 'layer_visible':
      if (typeof msg.layer_id !== 'string') return state;
      return { ...state, visibility: { ...state.visibility, [msg.layer_id]: !!msg.visible } };
    case 'play_sound':
    case 'reload':
      return state;
    default:
      return state;
  }
}

/** Local copy of a custom widget value, kept so a reloaded widget sees it. */
export function setWidgetValue(state: OverlayState, layerId: string, key: string, value: unknown): OverlayState {
  const current = state.widgetState[layerId] ?? {};
  const next = { ...current };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return { ...state, widgetState: { ...state.widgetState, [layerId]: next } };
}
