// Every part of a layer that custom CSS can target. The editor lists these and docs are made from them.
import type { LayerKind } from '$lib/bindings/LayerKind';

export type LayerType = LayerKind['type'];

export interface SelectorInfo {
  selector: string;
  /** Layer types it appears in. Empty means every layer. */
  kinds: readonly LayerType[];
  description: string;
}

export interface VariableInfo {
  name: string;
  kinds: readonly LayerType[];
  description: string;
}

const TEXT_KINDS: readonly LayerType[] = ['text', 'goal', 'counter', 'timer', 'event_list', 'alerts'];

export const SELECTORS: readonly SelectorInfo[] = [
  { selector: ':scope', kinds: [], description: 'This layer’s box' },
  { selector: '.cw-text', kinds: TEXT_KINDS, description: 'A piece of styled text' },
  { selector: '.cw-stroked', kinds: TEXT_KINDS, description: 'Text with an outline' },

  { selector: '.cw-text-layer', kinds: ['text'], description: 'The text block' },
  { selector: '.cw-shape', kinds: ['shape'], description: 'The drawn shape (SVG)' },
  { selector: '.cw-image', kinds: ['image'], description: 'The image' },
  { selector: '.cw-video', kinds: ['video'], description: 'The video' },
  { selector: '.cw-media', kinds: ['image', 'video'], description: 'The image or video' },

  { selector: '.cw-alert-wrap', kinds: ['alerts'], description: 'Fills the layer and centres the card' },
  { selector: '.cw-alert', kinds: ['alerts'], description: 'The alert card' },
  { selector: '.cw-carded', kinds: ['alerts'], description: 'The card when it has a fill' },
  { selector: '.cw-alert[data-kind="follow"]', kinds: ['alerts'], description: 'The card for one event kind' },
  { selector: '.cw-layout-media_left', kinds: ['alerts'], description: 'Layout class on the card (media_above, media_left, media_behind, text_only)' },
  { selector: '.cw-alert-media', kinds: ['alerts'], description: 'The image or video' },
  { selector: '.cw-alert-text', kinds: ['alerts'], description: 'Title, accent bar and message' },
  { selector: '.cw-alert-title', kinds: ['alerts'], description: 'The title' },
  { selector: '.cw-alert-accent', kinds: ['alerts'], description: 'The accent bar' },
  { selector: '.cw-alert-message', kinds: ['alerts'], description: 'The message' },

  { selector: '.cw-chat', kinds: ['chat'], description: 'The message list' },
  { selector: '.cw-top', kinds: ['chat'], description: 'The list when newest is on top' },
  { selector: '.cw-chat-line', kinds: ['chat'], description: 'Each message card' },
  { selector: '.cw-chat-line[data-user-id]', kinds: ['chat'], description: 'Messages from one chatter (by Twitch user id)' },
  // Chat content. Keep classes used inside a message together here.
  { selector: '.cw-chat-badge', kinds: ['chat'], description: 'Any badge' },
  { selector: '.cw-badge-twitch', kinds: ['chat'], description: 'A Twitch badge (moderator, subscriber…)' },
  { selector: '.cw-badge-7tv', kinds: ['chat'], description: 'A 7TV badge' },
  { selector: '.cw-badge-role', kinds: ['chat'], description: 'A built-in role icon, used when a badge image is missing' },
  { selector: '.cw-chat-name', kinds: ['chat'], description: 'The name' },
  { selector: '.cw-paint', kinds: ['chat'], description: 'A name with a 7TV paint' },
  { selector: '.cw-chat-sep', kinds: ['chat'], description: 'The colon after the name' },
  { selector: '.cw-chat-msg', kinds: ['chat'], description: 'The message text' },
  { selector: '.cw-emote', kinds: ['chat'], description: 'An emote' },
  { selector: '.cw-emote-twitch', kinds: ['chat'], description: 'A Twitch emote' },
  { selector: '.cw-emote-7tv', kinds: ['chat'], description: 'A 7TV emote' },
  { selector: '.cw-emote-bttv', kinds: ['chat'], description: 'A BetterTTV emote' },
  { selector: '.cw-emote-ffz', kinds: ['chat'], description: 'A FrankerFaceZ emote' },
  { selector: '.cw-emote-stack', kinds: ['chat'], description: 'An emote with zero-width emotes on top' },
  { selector: '.cw-emote-zw', kinds: ['chat'], description: 'A zero-width emote laid over the one before it' },
  { selector: '.cw-mention', kinds: ['chat'], description: 'An @mention' },
  { selector: '.cw-cheer', kinds: ['chat'], description: 'A cheer amount' },
  { selector: '.cw-action', kinds: ['chat'], description: 'A /me message' },

  { selector: '.cw-goal', kinds: ['goal'], description: 'The whole goal' },
  { selector: '.cw-goal-head', kinds: ['goal'], description: 'Title and numbers row' },
  { selector: '.cw-goal-title', kinds: ['goal'], description: 'The title' },
  { selector: '.cw-goal-numbers', kinds: ['goal'], description: 'Current and target numbers' },
  { selector: '.cw-goal-track', kinds: ['goal'], description: 'The bar background' },
  { selector: '.cw-goal-fill', kinds: ['goal'], description: 'The filled part of the bar' },
  { selector: '.cw-goal-shine', kinds: ['goal'], description: 'The shine that runs over the bar' },
  { selector: '.cw-reached', kinds: ['goal'], description: 'Added to .cw-goal once the target is reached' },
  { selector: '.cw-celebrate', kinds: ['goal'], description: 'Added to .cw-goal for a moment when it is reached' },

  { selector: '.cw-counter', kinds: ['counter'], description: 'The counter row' },
  { selector: '.cw-timer', kinds: ['timer'], description: 'The timer row' },

  { selector: '.cw-event-row', kinds: ['event_list'], description: 'Each event card, in list and ticker' },
  { selector: '.cw-list', kinds: ['event_list'], description: 'The list' },
  { selector: '.cw-list-item', kinds: ['event_list'], description: 'A row in list mode' },
  { selector: '.cw-ticker', kinds: ['event_list'], description: 'The ticker' },
  { selector: '.cw-ticker-item', kinds: ['event_list'], description: 'An item in ticker mode' },
  { selector: '.cw-ticker-sep', kinds: ['event_list'], description: 'The dot between ticker items' },

  { selector: '.cw-custom', kinds: ['custom'], description: 'The widget frame. Its own HTML has the widget’s CSS' }
];

export const VARIABLES: readonly VariableInfo[] = [
  { name: '--cw-name', kinds: ['chat', 'event_list'], description: 'Name colour on each card (set when tint or a name stripe is on)' },
  { name: '--cw-tint', kinds: ['chat', 'event_list'], description: 'Tint colour on each card' },
  { name: '--cw-lean', kinds: ['chat', 'event_list'], description: '1 or -1 when cards lean in turn' },
  { name: '--cw-accent', kinds: ['alerts'], description: 'Accent colour, on .cw-alert' },
  { name: '--cw-w', kinds: ['alerts'], description: 'Layer width inside its padding, on .cw-alert-wrap' },
  { name: '--cw-h', kinds: ['alerts'], description: 'Layer height inside its padding, on .cw-alert-wrap' },
  { name: '--cw-stroke-w', kinds: TEXT_KINDS, description: 'Outline width, on .cw-stroked' },
  { name: '--cw-stroke-c', kinds: TEXT_KINDS, description: 'Outline colour, on .cw-stroked' }
];

const applies = (kinds: readonly LayerType[], kind: LayerType) => kinds.length === 0 || kinds.includes(kind);

export function selectorsFor(kind: LayerType): SelectorInfo[] {
  return SELECTORS.filter((s) => applies(s.kinds, kind));
}

export function variablesFor(kind: LayerType): VariableInfo[] {
  return VARIABLES.filter((v) => applies(v.kinds, kind));
}

/** A ready rule to drop into the editor. */
export function ruleFor(selector: string): string {
  return `${selector} {\n  \n}\n`;
}

const KIND_NAMES: Record<LayerType, string> = {
  text: 'Text',
  shape: 'Shape',
  image: 'Image',
  video: 'Video',
  alerts: 'Alerts',
  chat: 'Chat',
  goal: 'Goal',
  counter: 'Counter',
  timer: 'Timer',
  event_list: 'Event list',
  custom: 'Custom widget'
};

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** The catalogue as Markdown, one table per layer type. */
export function selectorsMarkdown(): string {
  const out = [
    '# Custom CSS selectors',
    '',
    'Custom CSS only applies to its own layer. `:scope` is the layer’s box; other selectors match parts inside it.',
    ''
  ];
  for (const kind of Object.keys(KIND_NAMES) as LayerType[]) {
    out.push(`## ${KIND_NAMES[kind]}`, '', '| Selector | What it is |', '| --- | --- |');
    for (const s of selectorsFor(kind)) out.push(`| \`${cell(s.selector)}\` | ${cell(s.description)} |`);
    const vars = variablesFor(kind);
    if (vars.length) {
      out.push('', '| Variable | What it is |', '| --- | --- |');
      for (const v of vars) out.push(`| \`${v.name}\` | ${cell(v.description)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
