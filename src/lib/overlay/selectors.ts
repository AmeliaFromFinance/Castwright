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

const TEXT_KINDS: readonly LayerType[] = ['text', 'goal', 'counter', 'timer', 'event_list', 'alerts', 'poll', 'credits', 'ad_break', 'now_playing', 'hype_train', 'giveaway', 'queue'];

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
  { selector: '.cw-hl', kinds: ['chat'], description: 'A highlighted message (any reason)' },
  { selector: '.cw-hl-first', kinds: ['chat'], description: 'Highlighted: first message from this chatter' },
  { selector: '.cw-hl-mention', kinds: ['chat'], description: 'Highlighted: mentions your name' },
  { selector: '.cw-hl-keyword', kinds: ['chat'], description: 'Highlighted: has a keyword' },
  { selector: '.cw-hl-user', kinds: ['chat'], description: 'Highlighted: from a listed user, a mod or a VIP' },
  { selector: '.cw-hl-redeemed', kinds: ['chat'], description: 'Highlighted with channel points ("Highlight my message")' },
  { selector: '.cw-chat-line[data-highlight~="mention"]', kinds: ['chat'], description: 'Same as the classes above; data-highlight lists every reason' },
  // Chat content. Keep classes used inside a message together here.
  { selector: '.cw-chat-badge', kinds: ['chat', 'credits', 'giveaway'], description: 'Any badge' },
  { selector: '.cw-badge-twitch', kinds: ['chat', 'credits', 'giveaway'], description: 'A Twitch badge (moderator, subscriber…)' },
  { selector: '.cw-badge-7tv', kinds: ['chat', 'credits', 'giveaway'], description: 'A 7TV badge' },
  { selector: '.cw-badge-role', kinds: ['chat', 'credits', 'giveaway'], description: 'A built-in role icon, used when a badge image is missing' },
  { selector: '.cw-chat-name', kinds: ['chat'], description: 'The name' },
  { selector: '.cw-paint', kinds: ['chat', 'credits', 'giveaway'], description: 'A name with a 7TV paint' },
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

  { selector: '.cw-poll', kinds: ['poll'], description: 'The whole poll or prediction' },
  { selector: '.cw-poll[data-type="prediction"]', kinds: ['poll'], description: 'Only while it shows a prediction (poll for polls)' },
  { selector: '.cw-open', kinds: ['poll'], description: 'Added to .cw-poll while viewers can vote' },
  { selector: '.cw-ended', kinds: ['poll'], description: 'Added to .cw-poll while it shows the result' },
  { selector: '.cw-poll-head', kinds: ['poll'], description: 'The question row' },
  { selector: '.cw-poll-title', kinds: ['poll'], description: 'The question' },
  { selector: '.cw-poll-choices', kinds: ['poll'], description: 'The list of choices' },
  { selector: '.cw-poll-choice', kinds: ['poll'], description: 'Each choice card' },
  { selector: '.cw-winner', kinds: ['poll'], description: 'Added to the winning choice at the end' },
  { selector: '.cw-loser', kinds: ['poll'], description: 'Added to the other choices once there is a winner' },
  { selector: '.cw-poll-row', kinds: ['poll'], description: 'Name and numbers row of a choice' },
  { selector: '.cw-poll-label', kinds: ['poll'], description: 'The choice name' },
  { selector: '.cw-poll-nums', kinds: ['poll'], description: 'Count and percentage of a choice' },
  { selector: '.cw-poll-count', kinds: ['poll'], description: 'Votes or points for a choice' },
  { selector: '.cw-poll-pct', kinds: ['poll'], description: 'The percentage' },
  { selector: '.cw-poll-track', kinds: ['poll'], description: 'The bar background' },
  { selector: '.cw-poll-fill', kinds: ['poll'], description: 'The filled part of the bar' },
  { selector: '.cw-poll-foot', kinds: ['poll'], description: 'Time left and total row' },
  { selector: '.cw-poll-timer', kinds: ['poll'], description: 'Time left, or the result line' },
  { selector: '.cw-poll-total', kinds: ['poll'], description: 'Votes or points in total' },

  { selector: '.cw-credits', kinds: ['credits'], description: 'The whole roll, clipped to the layer' },
  { selector: '.cw-rolling', kinds: ['credits'], description: 'Added to .cw-credits while it moves' },
  { selector: '.cw-done', kinds: ['credits'], description: 'Added to .cw-credits once it has stopped at the end' },
  { selector: '.cw-paged', kinds: ['credits'], description: 'Added to .cw-credits when reduced motion shows pages' },
  { selector: '.cw-fade', kinds: ['credits'], description: 'Added to .cw-credits when the edges fade' },
  { selector: '.cw-waiting', kinds: ['credits'], description: 'Added to .cw-credits while it waits for the Roll credits step (hidden)' },
  { selector: '.cw-two', kinds: ['credits'], description: 'Added to .cw-credits with two columns' },
  { selector: '.cw-credits-roll', kinds: ['credits'], description: 'Everything that moves' },
  { selector: '.cw-credits-heading', kinds: ['credits'], description: 'The heading' },
  { selector: '.cw-credits-section', kinds: ['credits'], description: 'Each section card' },
  { selector: '.cw-credits-section[data-kind="followers"]', kinds: ['credits'], description: 'One section (followers, subscribers, gifters, cheerers, raiders, moderators, vips, chatters)' },
  { selector: '.cw-credits-title', kinds: ['credits'], description: 'A section title' },
  { selector: '.cw-credits-names', kinds: ['credits'], description: 'The names in a section' },
  { selector: '.cw-credits-row', kinds: ['credits'], description: 'One name with its amount' },
  { selector: '.cw-credits-name', kinds: ['credits'], description: 'The name' },
  { selector: '.cw-credits-amount', kinds: ['credits'], description: 'Months, gifts, bits, viewers or messages' },
  { selector: '.cw-credits-footer', kinds: ['credits'], description: 'The footer' },
  { selector: '.cw-ad', kinds: ['ad_break'], description: 'The whole heads-up' },
  { selector: '.cw-ad-soon', kinds: ['ad_break'], description: 'Added to .cw-ad before the ad' },
  { selector: '.cw-ad-running', kinds: ['ad_break'], description: 'Added to .cw-ad while the ad runs' },
  { selector: '.cw-ad[data-phase="running"]', kinds: ['ad_break'], description: 'Same as .cw-ad-running (soon before the ad)' },
  { selector: '.cw-ad-card', kinds: ['ad_break'], description: 'The card around the message' },
  { selector: '.cw-ad-text', kinds: ['ad_break'], description: 'The message' },

  { selector: '.cw-np', kinds: ['now_playing'], description: 'The whole layer' },
  { selector: '.cw-np-compact', kinds: ['now_playing'], description: 'Layout class on .cw-np (also .cw-np-card, .cw-np-vinyl)' },
  { selector: '.cw-np-card', kinds: ['now_playing'], description: 'Added to .cw-np in the card layout' },
  { selector: '.cw-np-vinyl', kinds: ['now_playing'], description: 'Added to .cw-np in the vinyl layout' },
  { selector: '.cw-np-playing', kinds: ['now_playing'], description: 'Added to .cw-np while the song plays' },
  { selector: '.cw-np-paused', kinds: ['now_playing'], description: 'Added to .cw-np while it is paused' },
  { selector: '.cw-np-still', kinds: ['now_playing'], description: 'Added to .cw-np when motion is reduced (the record stops spinning)' },
  { selector: '.cw-np-item', kinds: ['now_playing'], description: 'The card around the song' },
  { selector: '.cw-np-body', kinds: ['now_playing'], description: 'Cover and text row. Animates in when the song changes' },
  { selector: '.cw-np-art', kinds: ['now_playing'], description: 'The cover (the record in vinyl)' },
  { selector: '.cw-np-text', kinds: ['now_playing'], description: 'Title, artist, album and progress' },
  { selector: '.cw-np-line', kinds: ['now_playing'], description: 'One line of text, cut off with … when too long' },
  { selector: '.cw-np-title', kinds: ['now_playing'], description: 'The title (title · artist in compact)' },
  { selector: '.cw-np-artist', kinds: ['now_playing'], description: 'The artist' },
  { selector: '.cw-np-album', kinds: ['now_playing'], description: 'The album' },
  { selector: '.cw-np-progress', kinds: ['now_playing'], description: 'Bar and times' },
  { selector: '.cw-np-bar', kinds: ['now_playing'], description: 'The bar background' },
  { selector: '.cw-np-fill', kinds: ['now_playing'], description: 'The played part of the bar' },
  { selector: '.cw-np-smooth', kinds: ['now_playing'], description: 'Added to .cw-np-fill while it moves smoothly' },
  { selector: '.cw-np-times', kinds: ['now_playing'], description: 'Elapsed and length row' },
  { selector: '.cw-np-elapsed', kinds: ['now_playing'], description: 'Time played' },
  { selector: '.cw-np-duration', kinds: ['now_playing'], description: 'Length of the song' },
  { selector: '.cw-np[data-state="paused"]', kinds: ['now_playing'], description: 'Same as .cw-np-paused (playing while it plays)' },

  { selector: '.cw-hype', kinds: ['hype_train'], description: 'The whole layer' },
  { selector: '.cw-hype-bar', kinds: ['hype_train'], description: 'Added to .cw-hype in the bar layout' },
  { selector: '.cw-hype-card', kinds: ['hype_train'], description: 'Added to .cw-hype in the card layout' },
  { selector: '.cw-hype-running', kinds: ['hype_train'], description: 'Added to .cw-hype while the train runs' },
  { selector: '.cw-hype-ended', kinds: ['hype_train'], description: 'Added to .cw-hype while the end text shows' },
  { selector: '.cw-hype-golden', kinds: ['hype_train'], description: 'Added to .cw-hype on a golden Kappa train' },
  { selector: '.cw-hype-treasure', kinds: ['hype_train'], description: 'Added to .cw-hype on a treasure train' },
  { selector: '.cw-hype-shared', kinds: ['hype_train'], description: 'Added to .cw-hype on a shared train' },
  { selector: '.cw-hype-levelling', kinds: ['hype_train'], description: 'Added to .cw-hype while "Level up!" shows' },
  { selector: '.cw-hype-still', kinds: ['hype_train'], description: 'Added to .cw-hype when motion is reduced (no pop or flash)' },
  { selector: '.cw-hype[data-type="treasure"]', kinds: ['hype_train'], description: 'Train type: regular, golden_kappa or treasure' },
  { selector: '.cw-hype[data-level="5"]', kinds: ['hype_train'], description: 'The level the train is on' },
  { selector: '.cw-hype-item', kinds: ['hype_train'], description: 'The card around the train' },
  { selector: '.cw-hype-head', kinds: ['hype_train'], description: 'Icon, level, percent and time left (the whole row in the bar layout)' },
  { selector: '.cw-hype-icon', kinds: ['hype_train'], description: 'The train icon' },
  { selector: '.cw-hype-titles', kinds: ['hype_train'], description: 'Train kind and level, stacked (card layout)' },
  { selector: '.cw-hype-title', kinds: ['hype_train'], description: 'The kind of train, like "Golden Kappa train" (card layout)' },
  { selector: '.cw-hype-level', kinds: ['hype_train'], description: '"Level 3" ("Lv 3" in the bar layout)' },
  { selector: '.cw-hype-nums', kinds: ['hype_train'], description: 'Percent and time left' },
  { selector: '.cw-hype-pct', kinds: ['hype_train'], description: 'Percent to the next level' },
  { selector: '.cw-hype-timer', kinds: ['hype_train'], description: 'Time left' },
  { selector: '.cw-hype-track', kinds: ['hype_train'], description: 'The bar background' },
  { selector: '.cw-hype-fill', kinds: ['hype_train'], description: 'The filled part of the bar' },
  { selector: '.cw-hype-smooth', kinds: ['hype_train'], description: 'Added to .cw-hype-fill while it moves smoothly' },
  { selector: '.cw-hype-foot', kinds: ['hype_train'], description: 'Total and top contributors' },
  { selector: '.cw-hype-total', kinds: ['hype_train'], description: '"Total 4,820"' },
  { selector: '.cw-hype-top', kinds: ['hype_train'], description: 'The top contributors (card layout)' },
  { selector: '.cw-hype-top-item', kinds: ['hype_train'], description: 'One top contributor, bits or sub' },
  { selector: '.cw-hype-levelup', kinds: ['hype_train'], description: 'The "Level up!" banner over the card' },
  { selector: '.cw-hype-levelup-text', kinds: ['hype_train'], description: 'The words "Level up!"' },
  { selector: '.cw-hype-end', kinds: ['hype_train'], description: 'The end text' },
  { selector: '.cw-gw', kinds: ['giveaway'], description: 'The whole layer' },
  { selector: '.cw-gw[data-status="open"]', kinds: ['giveaway'], description: 'While entries are open (closed after, idle with no giveaway)' },
  { selector: '.cw-gw-open', kinds: ['giveaway'], description: 'Added to .cw-gw while entries are open' },
  { selector: '.cw-gw-drawn', kinds: ['giveaway'], description: 'Added to .cw-gw once a winner is drawn' },
  { selector: '.cw-gw-still', kinds: ['giveaway'], description: 'Added to .cw-gw when motion is reduced (no spin)' },
  { selector: '.cw-gw-card', kinds: ['giveaway'], description: 'The card' },
  { selector: '.cw-gw-head', kinds: ['giveaway'], description: 'The "Giveaway" label and entry count row' },
  { selector: '.cw-gw-label', kinds: ['giveaway'], description: 'The "Giveaway" label' },
  { selector: '.cw-gw-entries', kinds: ['giveaway'], description: 'How many entered' },
  { selector: '.cw-gw-title', kinds: ['giveaway'], description: 'The prize' },
  { selector: '.cw-gw-join', kinds: ['giveaway'], description: 'How to enter, while open' },
  { selector: '.cw-gw-window', kinds: ['giveaway'], description: 'The window the names spin in and the winner shows in' },
  { selector: '.cw-gw-window[data-phase="spinning"]', kinds: ['giveaway'], description: 'The window while it spins (landed after)' },
  { selector: '.cw-gw-reel', kinds: ['giveaway'], description: 'The spinning names, with the marker lines' },
  { selector: '.cw-gw-strip', kinds: ['giveaway'], description: 'The column of names that moves' },
  { selector: '.cw-gw-name', kinds: ['giveaway'], description: 'One name in the spin' },
  { selector: '.cw-gw-winner', kinds: ['giveaway'], description: 'The winner: badges and name' },
  { selector: '.cw-gw-winner-name', kinds: ['giveaway'], description: 'The winner’s name' },
  { selector: '.cw-gw-fade', kinds: ['giveaway'], description: 'Added to .cw-gw-winner as it appears' },

  { selector: '.cw-q', kinds: ['queue'], description: 'The whole layer' },
  { selector: '.cw-q[data-open="true"]', kinds: ['queue'], description: 'While the queue takes people' },
  { selector: '.cw-q-section', kinds: ['queue'], description: 'Each group: playing now or up next' },
  { selector: '.cw-q-playing', kinds: ['queue'], description: 'The playing now group' },
  { selector: '.cw-q-next', kinds: ['queue'], description: 'The up next group' },
  { selector: '.cw-q-label', kinds: ['queue'], description: 'A group heading' },
  { selector: '.cw-q-list', kinds: ['queue'], description: 'The people in a group' },
  { selector: '.cw-q-item', kinds: ['queue'], description: 'One person' },
  { selector: '.cw-q-player', kinds: ['queue'], description: 'Added to .cw-q-item for someone playing now' },
  { selector: '.cw-q-sub', kinds: ['queue'], description: 'Added to .cw-q-item for a subscriber' },
  { selector: '.cw-q-item[data-user-id]', kinds: ['queue'], description: 'One viewer (by Twitch user id)' },
  { selector: '.cw-q-pos', kinds: ['queue'], description: 'Place in line, like #3' },
  { selector: '.cw-q-name', kinds: ['queue'], description: 'The name' },
  { selector: '.cw-q-note', kinds: ['queue'], description: 'The note, like an in-game name' },

  { selector: '.cw-custom', kinds: ['custom'], description: 'The widget frame. Its own HTML has the widget’s CSS' }
];

export const VARIABLES: readonly VariableInfo[] = [
  { name: '--cw-name', kinds: ['chat', 'event_list'], description: 'Name colour on each card (set when tint or a name stripe is on)' },
  { name: '--cw-name', kinds: ['poll'], description: 'Bar colour on each choice (set when tint or a name stripe is on)' },
  { name: '--cw-name', kinds: ['queue'], description: 'Name colour on each person (set when tint or a name stripe is on)' },
  { name: '--cw-tint', kinds: ['chat', 'event_list', 'poll', 'giveaway', 'queue'], description: 'Tint colour on each card' },
  { name: '--cw-lean', kinds: ['chat', 'event_list', 'poll', 'queue'], description: '1 or -1 when cards lean in turn' },
  { name: '--cw-hl', kinds: ['chat'], description: 'Highlight colour on a highlighted .cw-chat-line' },
  { name: '--cw-pct', kinds: ['poll', 'hype_train'], description: 'The choice’s share, e.g. 42%, on .cw-poll-choice. Progress to the next level on .cw-hype' },
  { name: '--cw-hype-color', kinds: ['hype_train'], description: 'Bar colour, on .cw-hype' },
  { name: '--cw-accent', kinds: ['alerts'], description: 'Accent colour, on .cw-alert' },
  { name: '--cw-accent', kinds: ['giveaway'], description: 'Accent colour, on .cw-gw-window' },
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
  poll: 'Poll / prediction',
  credits: 'Credits',
  ad_break: 'Ad break',
  now_playing: 'Now playing',
  hype_train: 'Hype train',
  giveaway: 'Giveaway',
  queue: 'Viewer queue',
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
