// An overlay with one of every layer type, plus helpers to build events and alerts.
import type { AlertPlay } from '../../src/lib/bindings/AlertPlay';
import type { Animation } from '../../src/lib/bindings/Animation';
import type { BoxStyle } from '../../src/lib/bindings/BoxStyle';
import type { Event } from '../../src/lib/bindings/Event';
import type { EventKind } from '../../src/lib/bindings/EventKind';
import type { Layer } from '../../src/lib/bindings/Layer';
import type { Overlay } from '../../src/lib/bindings/Overlay';
import type { TextStyle } from '../../src/lib/bindings/TextStyle';

const text = (p: Partial<TextStyle> = {}): TextStyle => ({
  font_family: 'Inter',
  font_size: 24,
  font_weight: 600,
  color: '#ffffff',
  align: 'left',
  line_height: 1.25,
  letter_spacing: 0,
  uppercase: false,
  italic: false,
  shadow: '0 2px 6px rgba(0,0,0,0.45)',
  stroke_width: 0,
  stroke_color: '#000000',
  ...p
});

const none: Animation = { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_out' };
const anim = (preset: Animation['preset'], duration_ms = 450, easing: Animation['easing'] = 'ease_out'): Animation => ({
  preset,
  duration_ms,
  delay_ms: 0,
  easing
});
// Boxes in the shape older projects saved, so the overlay is checked against them.
const noBox = { background: 'transparent', border_color: 'transparent', border_width: 0, radius: 0, padding: 0, shadow: '', backdrop_blur: 0 } as BoxStyle;
const panel = {
  background: 'rgba(12,15,22,0.78)',
  border_color: 'rgba(255,255,255,0.08)',
  border_width: 1,
  radius: 14,
  padding: 16,
  shadow: '0 12px 40px rgba(0,0,0,0.35)',
  backdrop_blur: 10
} as BoxStyle;

function layer(id: string, kind: Layer['kind'], box: Partial<Layer>): Layer {
  return {
    id,
    name: id,
    kind,
    x: 0,
    y: 0,
    w: 300,
    h: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    visible_when: { mode: 'all', conditions: [] },
    box_style: noBox,
    enter: none,
    exit: none,
    idle: none,
    css: '',
    ...box
  };
}

export const WIDGET_JS = `
const $ = (id) => document.getElementById(id);
window.addEventListener('onWidgetLoad', (obj) => {
  $('status').textContent = 'loaded:' + obj.detail.fieldData.greeting;
  SE_API.store.get('hits').then((v) => { $('hits').textContent = 'hits:' + (v ? v.n : 0); });
});
window.addEventListener('onEventReceived', (obj) => {
  const d = obj.detail;
  if (d.listener === 'follower-latest') {
    $('last').textContent = 'follow:' + d.event.name;
    SE_API.store.set('hits', { n: 6, by: d.event.name });
  }
  if (d.listener === 'message') $('chat').textContent = 'msg:' + d.event.data.text;
  if (d.listener === 'delete-message') $('chat').textContent = 'deleted:' + d.event.msgId;
});
window.addEventListener('onSessionUpdate', (obj) => {
  $('session').textContent = 'follows:' + obj.detail.session['follower-session'].count;
});
`;

export function overlay(): Overlay {
  return {
    id: 'ov1',
    name: 'E2E',
    width: 1280,
    height: 720,
    fonts: ['Inter'],
    updated_at: 1,
    layers: [
      layer('bg', { type: 'shape', shape: 'rect', fill: 'rgba(91,141,239,0.10)', stroke: 'rgba(91,141,239,0.5)', stroke_width: 2 }, {
        x: 16, y: 16, w: 1248, h: 688, box_style: { ...noBox, radius: 24 }
      }),
      layer('title', { type: 'text', text: '{{stream.title}}', style: text({ font_size: 40, font_weight: 800, stroke_width: 3, stroke_color: '#1b1f2a' }) }, {
        x: 48, y: 40, w: 640, h: 60, enter: anim('slide_down', 500, 'back')
      }),
      layer('logo', { type: 'image', src: 'assets/logo.svg', fit: 'contain' }, { x: 1150, y: 36, w: 84, h: 84, idle: anim('float', 3000) }),
      layer('clip', { type: 'video', src: 'assets/clip.webm', fit: 'cover', looped: true, muted: true, volume: 0 }, {
        x: 1040, y: 36, w: 96, h: 84, box_style: { ...noBox, radius: 10 }, css: 'video { border-radius: 10px; }'
      }),
      layer('goal', {
        type: 'goal', title: 'Sub goal', current_var: 'session.subs', target: 10, bar_color: '#5b8def', track_color: 'rgba(255,255,255,0.14)',
        style: text({ font_size: 22 }), show_numbers: true
      }, { x: 48, y: 120, w: 460, h: 96, box_style: panel }),
      layer('deaths', { type: 'counter', var: 'counter.deaths', format: 'Deaths: {{value}}', style: text({ font_size: 26 }) }, {
        x: 528, y: 120, w: 220, h: 96, box_style: panel
      }),
      layer('countdown', { type: 'timer', mode: 'countdown', duration_s: 600, anchor_var: '', style: text({ font_size: 26, align: 'center' }), prefix: 'Break ' }, {
        x: 768, y: 120, w: 220, h: 96, box_style: panel
      }),
      layer('uptime', { type: 'timer', mode: 'uptime', duration_s: 0, anchor_var: '', style: text({ font_size: 26, align: 'center' }), prefix: 'Live ' }, {
        x: 1008, y: 120, w: 220, h: 96, box_style: panel
      }),
      layer('events', { type: 'event_list', kinds: [], max_items: 5, direction: 'vertical', item_format: '', style: text({ font_size: 20, font_weight: 500 }) }, {
        x: 48, y: 236, w: 360, h: 220, box_style: panel
      }),
      layer('chat', {
        type: 'chat', max_messages: 8, fade_after_s: 0, show_badges: true, hide_commands: true, hide_users: ['nightbot'],
        style: text({ font_size: 20, font_weight: 500 }), bubble: noBox, newest_on_top: false,
        seventv_emotes: true, bttv_emotes: true, ffz_emotes: true, seventv_paints: true, seventv_badges: true
      }, { x: 896, y: 236, w: 336, h: 360, box_style: panel }),
      layer('alerts', { type: 'alerts' }, { x: 420, y: 236, w: 460, h: 300 }),
      layer('widget', {
        type: 'custom',
        html: '<div class="w"><div id="status">waiting</div><div id="hits"></div><div id="last"></div><div id="chat"></div><div id="session"></div><p>{greeting}</p></div>',
        css: '.w{font:600 16px/1.5 sans-serif;color:{color};padding:12px;background:rgba(0,0,0,.55);border-radius:12px;height:100%;box-sizing:border-box}',
        js: WIDGET_JS,
        fields: { greeting: { type: 'text', label: 'Greeting', value: 'Hello' }, color: { type: 'colorpicker', label: 'Colour', value: '#c9b3ff' } },
        values: { greeting: 'Hi there' }
      }, { x: 48, y: 476, w: 360, h: 200 }),
      layer('ticker', { type: 'event_list', kinds: ['follow', 'cheer', 'raid'], max_items: 6, direction: 'ticker', item_format: '{{name}} {{label}}', style: text({ font_size: 20 }) }, {
        x: 420, y: 640, w: 812, h: 52, box_style: { ...panel, padding: 10 }
      }),
      layer('live-badge', { type: 'text', text: 'LIVE', style: text({ font_size: 20, font_weight: 800, align: 'center' }) }, {
        x: 700, y: 46, w: 90, h: 40, box_style: { ...noBox, background: '#e91916', radius: 8, padding: 6 },
        visible_when: { mode: 'all', conditions: [{ field: 'stream.live', op: 'is_true', value: null }] },
        enter: anim('pop', 400), exit: anim('fade', 200)
      })
    ]
  };
}

let n = 0;
export function event(kind: EventKind, p: Partial<Event> = {}): Event {
  n++;
  return {
    id: `ev-${n}`,
    kind,
    ts: Date.now(),
    user: { id: `user-${n}`, login: `viewer${n}`, display_name: `Viewer${n}` },
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
    ...p
  };
}

export function chat(message: string, p: Partial<Event> = {}): Event {
  return event('chat', { message, message_parts: [{ type: 'text', text: message }], ...p });
}

export function alert(p: Partial<AlertPlay> = {}): AlertPlay {
  n++;
  const e = event('sub', { tier: 1, user: { id: '7', login: 'nova_kat', display_name: 'Nova_Kat' } });
  return {
    id: `alert-${n}`,
    kind: 'sub',
    event: e,
    variation_id: 'v1',
    priority: 0,
    title: 'Nova_Kat subscribed!',
    message: 'Tier 1 · first month',
    image: 'assets/logo.svg',
    video: '',
    sound: '',
    volume: 70,
    duration_ms: 1500,
    enter: anim('pop', 450),
    exit: anim('fade', 300),
    layout: 'media_above',
    title_style: text({ font_size: 36, font_weight: 800 }),
    message_style: text({ font_size: 20, font_weight: 500 }),
    accent: '#9db8ff',
    background: 'rgba(12,15,22,0.86)',
    tts: false,
    ...p
  };
}
