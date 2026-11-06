// Alert editing helpers. Selection and rendering mirror src-tauri/src/alerts/mod.rs.
import samples from '$lib/api/fixtures/sample-events.json';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { AlertPlay } from '$lib/bindings/AlertPlay';
import type { AlertSettings } from '$lib/bindings/AlertSettings';
import type { AlertType } from '$lib/bindings/AlertType';
import type { Condition } from '$lib/bindings/Condition';
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { Overlay } from '$lib/bindings/Overlay';
import type { TextStyle } from '$lib/bindings/TextStyle';
import type { Variation } from '$lib/bindings/Variation';
import { evaluateGroup, resolve } from '$lib/logic/condition';
import { render } from '$lib/logic/template';
import { DEFAULT_BOX } from '$lib/overlay/styles';
import { clone, newId } from '$lib/editors/ids';
import type { Token } from '$lib/editors/tokens';
import { defaultSceneRule } from '$lib/overlay/scenes';

export function defaultTextStyle(patch: Partial<TextStyle> = {}): TextStyle {
  return {
    font_family: 'Default',
    font_size: 28,
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
    overflow: 'wrap',
    scroll_speed: 60,
    ...patch
  };
}

export function defaultVariation(patch: Partial<Variation> = {}): Variation {
  return {
    id: newId(),
    name: 'Default',
    enabled: true,
    conditions: { mode: 'all', conditions: [] },
    priority: 0,
    title: '{{name}}',
    message: '',
    image: '',
    video: '',
    sound: '',
    volume: 70,
    duration_ms: 6000,
    enter: { preset: 'slide_up', duration_ms: 450, delay_ms: 0, easing: 'ease_out' },
    exit: { preset: 'fade', duration_ms: 350, delay_ms: 0, easing: 'ease_out' },
    layout: 'media_above',
    title_style: defaultTextStyle({ font_size: 40, font_weight: 800 }),
    message_style: defaultTextStyle({ font_size: 24, font_weight: 500 }),
    accent: '#9db8ff',
    background: 'rgba(12,15,22,0.82)',
    card: null,
    tts: false,
    run_action: null,
    ...patch
  };
}

export function defaultSettings(): AlertSettings {
  return {
    gap_ms: 800,
    combine_gifts: true,
    blocked_words: [],
    hide_links: true,
    min_bits: 0,
    min_raid_viewers: 0,
    max_queue: 50
  };
}

/** Starting title and message per kind, as in the starter project. */
const STARTER_TEXT: Partial<Record<EventKind, [string, string]>> = {
  follow: ['{{name}} followed', 'Welcome in!'],
  sub: ['{{name}} subscribed!', 'Tier {{tier}}'],
  resub: ['{{name}} resubscribed', '{{months}} months · {{message}}'],
  gift_sub: ['{{name}} gifted a sub', 'to {{recipient_name}}'],
  community_gift: ['{{name}} gifted {{amount}} subs', 'Thank you!'],
  cheer: ['{{name}} cheered {{amount | number}} bits', '{{message}}'],
  raid: ['{{name}} is raiding', 'with {{amount | number}} viewers'],
  redemption: ['{{name}} redeemed {{data.reward_title}}', '{{message}}'],
  power_up: ['{{name}} used a power-up', '{{message}}'],
  hype_train_begin: ['Hype train!', 'Level {{data.level}}'],
  hype_train_end: ['Hype train over', 'Reached level {{data.level}}'],
  charity: ['{{name}} donated {{amount | number}} {{currency}}', '{{message}}'],
  shoutout_received: ['{{name}} gave us a shoutout', ''],
  ad_break: ['Ad break', 'Back in {{amount}} seconds']
};

export function newAlertType(kind: EventKind): AlertType {
  const [title, message] = STARTER_TEXT[kind] ?? ['{{name}}', ''];
  return { kind, enabled: true, variations: [defaultVariation({ title, message })] };
}

export function duplicateVariation(v: Variation, taken: readonly string[]): Variation {
  const base = `${v.name.replace(/ copy( \d+)?$/, '')} copy`;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base} ${n}`;
  return { ...clone(v), id: newId(), name };
}

/** Next unused "Variation N" name. */
export function nextVariationName(taken: readonly string[]): string {
  for (let n = taken.length + 1; ; n++) if (!taken.includes(`Variation ${n}`)) return `Variation ${n}`;
}

export interface FieldHint {
  value: string;
  label: string;
}

const F = {
  name: { value: 'name', label: 'Viewer name' },
  message: { value: 'message', label: 'Viewer message' },
  tier: { value: 'tier', label: 'Sub tier (1, 2 or 3)' },
  months: { value: 'months', label: 'Total months' },
  amount: { value: 'amount', label: 'Amount' },
  is_gift: { value: 'is_gift', label: 'Is a gift' },
  is_anonymous: { value: 'is_anonymous', label: 'Is anonymous' },
  recipient: { value: 'recipient_name', label: 'Recipient name' },
  prime: { value: 'data.is_prime', label: 'Prime sub' },
  reward: { value: 'data.reward_title', label: 'Reward title' },
  level: { value: 'data.level', label: 'Hype train level' },
  total: { value: 'data.total', label: 'Hype train total' },
  currency: { value: 'currency', label: 'Currency' },
  charity: { value: 'data.charity_name', label: 'Charity name' },
  login: { value: 'user.login', label: 'Viewer login' }
} satisfies Record<string, FieldHint>;

/** Fields worth offering in conditions for each kind. */
export function fieldsFor(kind: EventKind): FieldHint[] {
  switch (kind) {
    case 'follow':
      return [F.name, F.login];
    case 'sub':
      return [F.tier, F.prime, F.is_gift, F.name, F.months];
    case 'resub':
      return [F.months, F.tier, F.message, F.name];
    case 'gift_sub':
      return [F.tier, F.is_anonymous, F.recipient, F.name];
    case 'community_gift':
      return [F.amount, F.tier, F.is_anonymous, F.name];
    case 'cheer':
      return [F.amount, F.message, F.is_anonymous, F.name];
    case 'raid':
      return [{ value: 'amount', label: 'Raid viewers' }, F.name];
    case 'redemption':
      return [F.reward, { value: 'amount', label: 'Points cost' }, F.message, F.name];
    case 'power_up':
      return [{ value: 'data.power_up_type', label: 'Power-up type' }, { value: 'amount', label: 'Bits' }, F.message, F.name];
    case 'hype_train_begin':
    case 'hype_train_end':
      return [F.level, F.total];
    case 'charity':
      return [F.amount, F.currency, F.charity, F.name];
    case 'shoutout_received':
      return [{ value: 'amount', label: 'Their viewers' }, F.name];
    case 'ad_break':
      return [{ value: 'amount', label: 'Length in seconds' }, { value: 'data.is_automatic', label: 'Automatic ad' }];
    case 'chat':
      return [
        { value: 'data.first_chat', label: 'First message ever' },
        F.message,
        F.name,
        { value: 'roles.moderator', label: 'Is a moderator' },
        { value: 'roles.subscriber', label: 'Is a subscriber' }
      ];
    default:
      return [F.name, F.amount, F.message];
  }
}

/** Template tokens offered as chips for each kind. */
export function tokensFor(kind: EventKind): Token[] {
  const name: Token = { token: 'name', label: 'Viewer name' };
  const message: Token = { token: 'message', label: 'Viewer message' };
  const amount: Token = { token: 'amount | number', label: 'Amount' };
  switch (kind) {
    case 'follow':
      return [name];
    case 'chat':
      return [name, message];
    case 'sub':
      return [name, { token: 'tier' }, { token: 'months' }];
    case 'resub':
      return [name, { token: 'months' }, { token: 'tier' }, message];
    case 'gift_sub':
      return [name, { token: 'recipient_name' }, { token: 'tier' }];
    case 'community_gift':
      return [name, { token: 'amount' }, { token: 'tier' }];
    case 'cheer':
      return [name, amount, message];
    case 'raid':
      return [name, amount];
    case 'redemption':
      return [name, { token: 'data.reward_title' }, { token: 'amount' }, message];
    case 'power_up':
      return [name, { token: 'amount' }, message];
    case 'hype_train_begin':
    case 'hype_train_end':
      return [{ token: 'data.level' }, { token: 'data.total' }];
    case 'charity':
      return [name, amount, { token: 'currency' }, { token: 'data.charity_name' }];
    case 'shoutout_received':
      return [name, { token: 'amount' }];
    case 'ad_break':
      return [{ token: 'amount' }];
    default:
      return [name, message];
  }
}

const SAMPLES = samples as unknown as Event[];

/** A realistic event of `kind` for previews. */
export function sampleEvent(kind: EventKind): Event {
  const found = SAMPLES.find((e) => e.kind === kind) ?? SAMPLES.find((e) => e.kind === 'custom') ?? SAMPLES[0]!;
  return { ...clone(found), kind, id: 'preview', test: true };
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.split('.');
  let cur = obj;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

/** Value that satisfies one condition, or undefined when there's no obvious one. */
function satisfying(op: Condition['op'], value: unknown, current: unknown): unknown {
  const n = typeof value === 'number' ? value : null;
  const text = typeof value === 'string' ? value : String(value ?? '');
  switch (op) {
    case 'eq':
    case 'gte':
    case 'lte':
      return value;
    case 'gt':
      return n !== null ? n + 1 : undefined;
    case 'lt':
      return n !== null ? n - 1 : undefined;
    case 'contains':
      return `${typeof current === 'string' ? `${current} ` : ''}${text}`;
    case 'starts_with':
      return `${text}${typeof current === 'string' ? ` ${current}` : ''}`;
    case 'ends_with':
      return `${typeof current === 'string' ? `${current} ` : ''}${text}`;
    case 'is_true':
      return true;
    case 'is_false':
      return false;
    case 'exists':
      return current ?? 'sample';
    default:
      return undefined;
  }
}

/** The sample event, adjusted so it matches `v` where that's easy. Fields Rust adds (name...) are left alone. */
export function sampleFor(kind: EventKind, v: Variation | null): Event {
  const base = sampleEvent(kind);
  if (!v || v.conditions.conditions.length === 0) return base;
  const e = clone(base) as unknown as Record<string, unknown>;
  const conds = v.conditions.mode === 'all' ? v.conditions.conditions : v.conditions.conditions.slice(0, 1);
  for (const c of conds) {
    if (!c.field || c.field === 'name' || c.field === 'recipient_name' || c.field === 'kind') continue;
    const want = satisfying(c.op, c.value, resolve(e, c.field));
    if (want !== undefined) setPath(e, c.field, want);
  }
  const adjusted = e as unknown as Event;
  return evaluateGroup(v.conditions, alertContext(adjusted)) ? adjusted : base;
}

/** Same fields as Event::as_context in Rust. */
/** Event fields plus variables; event fields win on a clash, like the backend. */
export function alertContext(e: Event, vars: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...vars,
    ...e,
    name: e.user?.display_name ?? (e.is_anonymous ? 'Anonymous' : ''),
    recipient_name: e.recipient?.display_name ?? '',
    kind: e.kind
  };
}

export function containsBlocked(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.map((w) => w.trim().toLowerCase()).some((w) => w !== '' && lower.includes(w));
}

function looksLikeLink(word: string): boolean {
  const w = word.replace(/^[()[\]<>"',!?]+|[()[\]<>"',!?]+$/g, '').toLowerCase();
  if (w.startsWith('http://') || w.startsWith('https://') || w.startsWith('www.')) return true;
  const host = (w.split('/')[0] ?? '').replace(/\.+$/, '');
  const parts = host.split('.');
  if (parts.length < 2) return false;
  const first = parts[0] ?? '';
  const tld = parts[parts.length - 1] ?? '';
  return (
    first !== '' &&
    /^[a-z0-9-]+$/.test(first) &&
    tld.length >= 2 &&
    /^[a-z]+$/.test(tld) &&
    parts.every((p) => p !== '')
  );
}

export function hideLinks(text: string): string {
  return text
    .split(' ')
    .map((w) => (looksLikeLink(w) ? '[link]' : w))
    .join(' ');
}

/** The variation that plays for `event`: first enabled match, like the backend. */
export function pickVariation(
  type: AlertType | undefined,
  event: Event,
  vars: Record<string, unknown> = {}
): Variation | null {
  if (!type || !type.enabled) return null;
  const ctx = alertContext(event, vars);
  return type.variations.find((v) => v.enabled && evaluateGroup(v.conditions, ctx)) ?? null;
}

/** Render `v` for `event` the way the backend does (links hidden, blocked words removed). */
export function renderPlay(
  v: Variation,
  event: Event,
  s: AlertSettings,
  id = newId(),
  vars: Record<string, unknown> = {}
): AlertPlay {
  const e = clone(event);
  let tts = v.tts;
  if (e.message !== null) {
    let cleaned = s.hide_links ? hideLinks(e.message) : e.message;
    if (containsBlocked(cleaned, s.blocked_words)) {
      cleaned = '';
      tts = false;
    }
    e.message = cleaned;
  }
  const ctx = alertContext(e, vars);
  return {
    id,
    kind: e.kind,
    event: e,
    variation_id: v.id,
    priority: v.priority,
    title: render(v.title, ctx),
    message: render(v.message, ctx),
    image: v.image,
    video: v.video,
    sound: v.sound,
    volume: Math.min(100, v.volume),
    duration_ms: Math.min(120_000, Math.max(500, v.duration_ms)),
    enter: clone(v.enter),
    exit: clone(v.exit),
    layout: v.layout,
    title_style: clone(v.title_style),
    message_style: clone(v.message_style),
    accent: v.accent,
    background: v.background,
    card: v.card ? clone(v.card) : null,
    tts
  };
}

/** What would play for `event`, or null. Mirrors build_play. */
export function buildPlay(config: AlertConfig, event: Event, vars: Record<string, unknown> = {}): AlertPlay | null {
  const s = config.settings;
  const amount = Math.trunc(event.amount ?? 0);
  if (event.kind === 'cheer' && amount < s.min_bits) return null;
  if (event.kind === 'raid' && amount < s.min_raid_viewers) return null;
  if (event.kind === 'gift_sub' && s.combine_gifts && 'community_gift_id' in event.data) return null;
  if (event.kind === 'community_gift' && !s.combine_gifts) return null;
  const v = pickVariation(
    config.types.find((t) => t.kind === event.kind),
    event,
    vars
  );
  return v ? renderPlay(v, event, s, newId(), vars) : null;
}

/** "a, b ,, c" -> ["a", "b", "c"] */
export function parseWordList(text: string): string[] {
  return text
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w !== '');
}

export const PREVIEW_SIZE = { width: 800, height: 420 };

/** A one-layer overlay that only shows alerts, for the preview. */
export function previewOverlay(width = PREVIEW_SIZE.width, height = PREVIEW_SIZE.height): Overlay {
  const none = { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_out' } as const;
  return {
    id: 'alert-preview',
    name: 'Alert preview',
    width,
    height,
    fonts: [],
    updated_at: 0,
    layers: [
      {
        id: 'alerts',
        name: 'Alerts',
        kind: { type: 'alerts' },
        x: 0,
        y: 0,
        w: width,
        h: height,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        visible_when: { mode: 'all', conditions: [] },
        scenes: defaultSceneRule(),
        box_style: structuredClone(DEFAULT_BOX),
        enter: { ...none },
        exit: { ...none },
        idle: { ...none },
        css: ''
      }
    ]
  };
}

/** Size of the first alerts layer in the project, so the preview matches it. */
export function alertsLayerSize(overlays: readonly Overlay[]): { width: number; height: number } {
  for (const o of overlays) {
    const l = o.layers.find((x) => x.kind.type === 'alerts');
    if (l && l.w > 0 && l.h > 0) return { width: Math.round(l.w), height: Math.round(l.h) };
  }
  return { ...PREVIEW_SIZE };
}

export const ANIM_PRESETS = [
  ['none', 'None'],
  ['fade', 'Fade'],
  ['slide_up', 'Slide up'],
  ['slide_down', 'Slide down'],
  ['slide_left', 'Slide left'],
  ['slide_right', 'Slide right'],
  ['zoom', 'Zoom'],
  ['pop', 'Pop'],
  ['bounce', 'Bounce'],
  ['flip', 'Flip'],
  ['pulse', 'Pulse'],
  ['float', 'Float'],
  ['shake', 'Shake'],
  ['spin', 'Spin']
] as const;

export const EASINGS = [
  ['ease_out', 'Ease out'],
  ['ease_in', 'Ease in'],
  ['ease_in_out', 'Ease in and out'],
  ['linear', 'Linear'],
  ['spring', 'Spring'],
  ['back', 'Overshoot']
] as const;

export const LAYOUTS = [
  ['media_above', 'Media above text'],
  ['media_left', 'Media left of text'],
  ['media_behind', 'Media behind text'],
  ['text_only', 'Text only']
] as const;

export const FONTS = ['Default', 'Inter', 'Poppins', 'Montserrat', 'Roboto', 'Lato', 'Oswald', 'Bebas Neue', 'Press Start 2P', 'Nunito', 'Rubik', 'Arial', 'Georgia'];
