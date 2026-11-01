import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { Layer } from '$lib/bindings/Layer';
import type { LayerKind } from '$lib/bindings/LayerKind';
import type { AlertPlay } from '$lib/bindings/AlertPlay';
import { DEFAULT_TEXT } from '../styles';

let n = 0;

export function ev(kind: EventKind, patch: Partial<Event> = {}): Event {
  n++;
  return {
    id: `e${n}`,
    kind,
    ts: 1_700_000_000_000 + n * 1000,
    user: { id: `u${n}`, login: 'nova_kat', display_name: 'Nova_Kat' },
    amount: null,
    currency: null,
    tier: null,
    months: null,
    message: null,
    message_parts: [],
    roles: { broadcaster: false, moderator: false, vip: false, subscriber: false },
    is_gift: false,
    is_anonymous: false,
    recipient: null,
    data: {},
    test: false,
    ...patch
  };
}

const NONE = { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_out' } as const;

export function layer(kind: LayerKind, patch: Partial<Layer> = {}): Layer {
  n++;
  return {
    id: `l${n}`,
    name: 'Layer',
    kind,
    x: 0,
    y: 0,
    w: 400,
    h: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    visible_when: { mode: 'all', conditions: [] },
    box_style: { background: 'transparent', border_color: 'transparent', border_width: 0, radius: 0, padding: 0, shadow: '', backdrop_blur: 0 },
    enter: { ...NONE },
    exit: { ...NONE },
    idle: { ...NONE },
    css: '',
    ...patch
  };
}

export function alertPlay(patch: Partial<AlertPlay> = {}): AlertPlay {
  n++;
  return {
    id: `a${n}`,
    kind: 'follow',
    event: ev('follow'),
    variation_id: 'v',
    priority: 0,
    title: 'Nova followed!',
    message: '',
    image: '',
    video: '',
    sound: '',
    volume: 70,
    duration_ms: 6000,
    enter: { preset: 'slide_up', duration_ms: 450, delay_ms: 0, easing: 'ease_out' },
    exit: { preset: 'fade', duration_ms: 350, delay_ms: 0, easing: 'ease_out' },
    layout: 'media_above',
    title_style: { ...DEFAULT_TEXT, font_size: 40 },
    message_style: { ...DEFAULT_TEXT },
    accent: '#9db8ff',
    background: 'rgba(12,15,22,0.82)',
    tts: false,
    ...patch
  };
}
