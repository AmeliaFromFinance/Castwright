// Tiny overlays that show a style preset with the real renderer.
import type { AlertPlay } from '$lib/bindings/AlertPlay';
import type { Event } from '$lib/bindings/Event';
import type { Layer } from '$lib/bindings/Layer';
import type { LayerKind } from '$lib/bindings/LayerKind';
import type { Overlay } from '$lib/bindings/Overlay';
import type { TextStyle } from '$lib/bindings/TextStyle';
import { presetBox, presetCard, presetText, type BoxPreset, type PresetTarget } from '$lib/overlay/presets';
import { defaultChatRules } from '$lib/overlay/chat-filters';
import type { ActiveAlert } from '$lib/overlay/state';
import { DEFAULT_BOX, DEFAULT_TEXT } from '$lib/overlay/styles';
import { defaultSceneRule } from '$lib/overlay/scenes';

export const PREVIEW_W = 320;
export const PREVIEW_H: Record<PresetTarget, number> = { layer: 140, chat: 170, events: 150, alert: 200 };

const none = { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_out' } as const;

function layer(id: string, kind: LayerKind, x: number, y: number, w: number, h: number, box = DEFAULT_BOX): Layer {
  return {
    // Unique per preview: styles are scoped by layer id.
    id,
    name: 'Preview',
    kind,
    x,
    y,
    w,
    h,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    visible_when: { mode: 'all', conditions: [] },
    scenes: defaultSceneRule(),
    box_style: structuredClone(box),
    enter: { ...none },
    exit: { ...none },
    idle: { ...none },
    css: ''
  };
}

const text = (p: Partial<TextStyle>, size: number): TextStyle => presetText({ ...DEFAULT_TEXT, font_size: size }, p);

function user(i: number, name: string) {
  return { id: `u${i}`, login: name.toLowerCase(), display_name: name };
}

function ev(i: number, kind: Event['kind'], name: string, color: string, message: string | null = null): Event {
  return {
    id: `p${i}`,
    kind,
    ts: 0,
    user: user(i, name),
    amount: null,
    currency: null,
    tier: kind === 'sub' ? 1 : null,
    months: null,
    message,
    message_parts: message ? [{ type: 'text', text: message }] : [],
    roles: { broadcaster: false, moderator: false, vip: false, subscriber: false },
    is_gift: false,
    is_anonymous: false,
    recipient: null,
    data: { color },
    test: true
  };
}

export const PREVIEW_CHAT: Event[] = [ev(1, 'chat', 'nova_kat', '#FF7F50', 'love this look'), ev(2, 'chat', 'pixelbyte', '#1E90FF', 'gg!')];
export const PREVIEW_EVENTS: Event[] = [ev(3, 'follow', 'LumenLark', '#9ACD32'), ev(4, 'sub', 'quietfox', '#FF69B4')];

export function previewOverlay(p: BoxPreset, target: PresetTarget): Overlay {
  const h = PREVIEW_H[target];
  const w = PREVIEW_W;
  const id = `preset-${p.id}-${target}`;
  let l: Layer;
  if (target === 'chat') {
    l = layer(
      id,
      {
        type: 'chat',
        max_messages: 2,
        fade_after_s: 0,
        show_badges: false,
        hide_commands: true,
        hide_users: [],
        seventv_emotes: false,
        bttv_emotes: false,
        ffz_emotes: false,
        seventv_paints: false,
        seventv_badges: false,
        style: text(p.text ?? {}, 22),
        bubble: presetBox(p, 'chat'),
        newest_on_top: false,
        item_card: presetCard(p),
        filters: 'off',
        own_rules: defaultChatRules(),
        hide_bots: false
      },
      22,
      14,
      w - 44,
      h - 28
    );
  } else if (target === 'events') {
    l = layer(
      id,
      {
        type: 'event_list',
        kinds: [],
        max_items: 2,
        direction: 'vertical',
        item_format: '{{name}} · {{label}}',
        style: text(p.text ?? {}, 22),
        item_box: presetBox(p, 'events'),
        item_card: presetCard(p)
      },
      22,
      24,
      w - 44,
      h - 48
    );
  } else if (target === 'alert') {
    l = layer(id, { type: 'alerts' }, 0, 0, w, h);
  } else {
    l = layer(id, { type: 'text', text: p.name, style: text({ ...(p.title ?? p.text ?? {}), align: 'center' }, 36) }, 40, 40, w - 80, h - 80, presetBox(p, 'layer'));
  }
  return { id, name: p.name, width: w, height: h, layers: [l], fonts: [], updated_at: 0 };
}

export function previewAlert(p: BoxPreset): ActiveAlert {
  const play: AlertPlay = {
    id: `preset-${p.id}`,
    kind: 'follow',
    event: PREVIEW_EVENTS[0]!,
    variation_id: 'preview',
    priority: 0,
    title: 'LumenLark followed',
    message: 'Welcome in!',
    image: '',
    video: '',
    sound: '',
    volume: 0,
    duration_ms: 3_600_000,
    enter: { ...none },
    exit: { ...none },
    layout: 'text_only',
    title_style: text({ font_weight: 800, ...(p.title ?? {}), font_size: Math.min(30, p.title?.font_size ?? 30) }, 30),
    message_style: text({ font_weight: 500, ...(p.message ?? {}), font_size: Math.min(18, p.message?.font_size ?? 18) }, 18),
    accent: p.accent ?? '#9db8ff',
    background: '',
    card: presetBox(p, 'alert'),
    tts: false
  };
  return { play, startedAt: Date.now() - 5000, stoppedAt: null };
}
