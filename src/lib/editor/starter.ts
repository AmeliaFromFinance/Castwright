// Layouts a new overlay can start from.
import type { Layer } from '$lib/bindings/Layer';
import type { Overlay } from '$lib/bindings/Overlay';
import { baseLayer, defaultBoxStyle, defaultTextStyle, kindDefaults, newId, panelBox } from './layers';

export type SizePreset = 'landscape' | 'hd' | 'vertical' | 'custom';

export const SIZE_PRESETS: ReadonlyArray<{ id: SizePreset; label: string; width: number; height: number }> = [
  { id: 'landscape', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'hd', label: '1280 × 720', width: 1280, height: 720 },
  { id: 'vertical', label: '1080 × 1920', width: 1080, height: 1920 },
  { id: 'custom', label: 'Custom', width: 1920, height: 1080 }
];

export const MAX_SIZE = 7680;

export function clampSize(n: number): number {
  return Math.min(MAX_SIZE, Math.max(16, Math.round(Number.isFinite(n) ? n : 1920)));
}

/**
 * A calm starting point: a goal, chat, alerts area, an event ticker and a "Live" label.
 * Positions are worked out for the canvas so landscape and vertical both look right.
 */
export function starterLayers(width: number, height: number): Layer[] {
  const u = Math.min(width, height) / 1080;
  const px = (n: number) => Math.round(n * u);
  const m = px(48);
  const portrait = height > width;
  const text = (size: number, weight = 500) => ({ ...defaultTextStyle(), font_size: px(size), font_weight: weight });
  const panel = { ...panelBox(), padding: px(16), radius: px(14) };

  const goalW = Math.min(width - m * 2, px(560));
  const chatW = portrait ? width - m * 2 : px(480);
  const chatH = portrait ? Math.round(height * 0.28) : Math.round(height * 0.6);
  const tickerH = px(56);
  const tickerW = portrait ? width - m * 2 : Math.round(width * 0.42);
  const alertsW = Math.min(width - m * 2, px(800));
  const alertsH = px(420);

  const layer = (p: Partial<Layer>): Layer => ({ ...baseLayer(), ...p });
  return [
    layer({
      name: 'Sub goal',
      kind: {
        ...kindDefaults('goal'),
        title: 'Sub goal',
        current_var: 'session.subs',
        target: 20,
        bar_color: '#5b8def',
        track_color: 'rgba(255,255,255,0.14)',
        style: text(22)
      },
      x: m,
      y: m,
      w: goalW,
      h: px(110),
      box_style: panel,
      enter: { preset: 'slide_down', duration_ms: 500, delay_ms: 0, easing: 'ease_out' }
    }),
    layer({
      name: 'Live',
      kind: { type: 'text', text: 'LIVE', style: { ...text(20, 800), align: 'center', letter_spacing: 2, shadow: '' } },
      x: width - m - px(110),
      y: m,
      w: px(110),
      h: px(44),
      box_style: { ...defaultBoxStyle(), background: '#e5484d', radius: px(10), padding: px(8) },
      visible_when: { mode: 'all', conditions: [{ field: 'stream.live', op: 'is_true', value: null }] },
      enter: { preset: 'pop', duration_ms: 400, delay_ms: 0, easing: 'ease_out' }
    }),
    layer({
      name: 'Chat',
      kind: { ...kindDefaults('chat'), max_messages: 10, style: text(22) },
      x: width - m - chatW,
      y: portrait ? height - m - tickerH - px(24) - chatH : Math.round((height - chatH) / 2),
      w: chatW,
      h: chatH,
      box_style: panel
    }),
    layer({
      name: 'Recent events',
      kind: {
        ...kindDefaults('event_list'),
        kinds: ['follow', 'sub', 'resub', 'gift_sub', 'community_gift', 'cheer', 'raid'],
        max_items: 6,
        direction: 'ticker',
        item_format: '{{name}} · {{label}}',
        style: text(22)
      },
      x: Math.round((width - tickerW) / 2),
      y: height - m - tickerH,
      w: tickerW,
      h: tickerH,
      box_style: { ...panel, padding: px(12) }
    }),
    layer({
      name: 'Alerts',
      kind: { type: 'alerts' },
      x: Math.round((width - alertsW) / 2),
      y: portrait ? Math.round(height * 0.2) : px(80),
      w: alertsW,
      h: alertsH
    })
  ];
}

export function newOverlay(name: string, width: number, height: number, starter: boolean): Overlay {
  const w = clampSize(width);
  const h = clampSize(height);
  return {
    id: newId(),
    name: name.trim() || 'New overlay',
    width: w,
    height: h,
    layers: starter ? starterLayers(w, h) : [],
    fonts: ['Inter'],
    updated_at: 0
  };
}
