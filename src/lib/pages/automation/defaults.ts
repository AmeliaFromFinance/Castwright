// Defaults for new triggers, steps and actions. Values follow the Rust model
// (src-tauri/src/model/automation.rs): serde defaults where they exist, and a
// sensible starting value for required fields.
import type { Action } from '$lib/bindings/Action';
import type { EventKind } from '$lib/bindings/EventKind';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { newId } from '$lib/editors/ids';
import { fromTree } from './graph';
import type { MenuGroup } from '$lib/editors/menu';

export type TriggerType = Trigger['type'];
export type StepType = Step['type'];
export type TriggerOf<T extends TriggerType> = Extract<Trigger, { type: T }>;
export type StepOf<T extends StepType> = Extract<Step, { type: T }>;

const empty = () => ({ mode: 'all' as const, conditions: [] });

export function newTrigger(type: TriggerType): Trigger {
  switch (type) {
    case 'event':
      return { type, kind: 'follow', conditions: empty() };
    case 'command':
      return { type, name: '', aliases: [], permission: 'everyone', user_cooldown_s: 0 };
    case 'timer':
      return { type, interval_s: 600, only_when_live: false, min_chat_lines: 0 };
    case 'scene_changed':
      return { type, scene: '' };
    case 'stream_online':
    case 'stream_offline':
    case 'manual':
      return { type };
  }
}

export function newStep(type: StepType): Step {
  switch (type) {
    case 'chat_send':
      return { type, message: '', as_bot: false, reply: false };
    case 'chat_announce':
      return { type, message: '', color: '' };
    case 'shoutout':
      return { type, user: '', message: '' };
    case 'create_clip':
    case 'save_replay':
    case 'stop':
      return { type };
    case 'create_marker':
      return { type, description: '' };
    case 'run_ad':
      return { type, length_s: 30 };
    case 'set_stream_info':
      return { type, title: '', category: '' };
    case 'timeout_user':
      return { type, user: '', duration_s: 60, reason: '' };
    case 'delay':
      return { type, ms: 1000 };
    case 'set_variable':
      return { type, key: '', value: '', persist: false };
    case 'add_to_variable':
      return { type, key: '', amount: 1, persist: false };
    case 'switch_scene':
      return { type, scene: '' };
    case 'set_source_visible':
      return { type, scene: '', source: '', state: 'on' };
    case 'set_input_mute':
      return { type, input: '', state: 'on' };
    case 'recording':
      return { type, state: 'on' };
    case 'set_layer_visible':
      return { type, overlay_id: '', layer_id: '', state: 'on' };
    case 'play_alert':
      return { type, title: '', message: '', image: '', sound: '', duration_ms: 6000 };
    case 'play_sound':
      return { type, src: '', volume: 70 };
    case 'http_request':
      return { type, method: 'get', url: '', body: '', save_to: '' };
    case 'run_script':
      return { type, code: '' };
    case 'if':
      return { type, conditions: empty(), then: [], else: [] };
    case 'run_action':
      return { type, action_id: '' };
    case 'log':
      return { type, message: '' };
  }
}

export function newAction(patch: Partial<Action> = {}): Action {
  return {
    id: newId(),
    name: 'New action',
    group: 'General',
    enabled: true,
    triggers: [],
    steps: [],
    graph: { nodes: [], edges: [] },
    cooldown_s: 0,
    ...patch
  };
}

/** An action whose graph is the triggers on top and the steps chained below. */
function chained(patch: Partial<Action>, triggers: Trigger[], steps: Step[]): Action {
  return newAction({ ...patch, triggers, graph: fromTree(triggers, steps) });
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  event: 'Twitch event',
  command: 'Chat command',
  timer: 'Timer',
  stream_online: 'Stream goes live',
  stream_offline: 'Stream ends',
  scene_changed: 'Scene changes',
  manual: 'Button or Stream Deck'
};

export const TRIGGER_MENU: MenuGroup<TriggerType>[] = [
  {
    items: [
      { value: 'command', label: 'Chat command', hint: 'Someone types !command' },
      { value: 'event', label: 'Twitch event', hint: 'Follow, sub, raid, redemption…' },
      { value: 'timer', label: 'Timer', hint: 'Every few minutes' },
      { value: 'stream_online', label: 'Stream goes live' },
      { value: 'stream_offline', label: 'Stream ends' },
      { value: 'scene_changed', label: 'Scene changes', hint: 'In OBS' },
      { value: 'manual', label: 'Button or Stream Deck', hint: 'Run from the app or a web request' }
    ]
  }
];

/** Same names as step_label in Rust, used in run errors. */
export const STEP_LABELS: Record<StepType, string> = {
  chat_send: 'Send chat message',
  chat_announce: 'Announcement',
  shoutout: 'Shoutout',
  create_clip: 'Create clip',
  create_marker: 'Stream marker',
  run_ad: 'Run ad',
  set_stream_info: 'Set stream info',
  timeout_user: 'Time out user',
  delay: 'Wait',
  set_variable: 'Set variable',
  add_to_variable: 'Add to variable',
  switch_scene: 'Switch scene',
  set_source_visible: 'Show/hide source',
  set_input_mute: 'Mute/unmute',
  recording: 'Recording',
  save_replay: 'Save replay',
  set_layer_visible: 'Show/hide overlay layer',
  play_alert: 'Play alert',
  play_sound: 'Play sound',
  http_request: 'Web request',
  run_script: 'Run script',
  if: 'If',
  run_action: 'Run action',
  stop: 'Stop',
  log: 'Log'
};

export const STEP_GROUPS: Array<{ label: string; items: Array<[StepType, string?]> }> = [
  { label: 'Chat', items: [['chat_send', 'Post a message in chat'], ['chat_announce', 'Highlighted message']] },
  {
    label: 'Twitch',
    items: [
      ['shoutout', 'Official /shoutout'],
      ['create_clip'],
      ['create_marker'],
      ['run_ad'],
      ['set_stream_info', 'Title and category'],
      ['timeout_user']
    ]
  },
  {
    label: 'OBS',
    items: [['switch_scene'], ['set_source_visible'], ['set_input_mute'], ['recording', 'Start, stop or toggle'], ['save_replay']]
  },
  { label: 'Overlays & alerts', items: [['set_layer_visible'], ['play_alert', 'Queue a custom alert'], ['play_sound']] },
  { label: 'Variables', items: [['set_variable'], ['add_to_variable', 'Counters, totals']] },
  {
    label: 'Logic',
    items: [['if', 'Go one way or another'], ['delay', 'Pause before the next step'], ['run_action', 'Run another action\'s steps'], ['stop', 'End this run']]
  },
  { label: 'Advanced', items: [['http_request', 'Call a web address'], ['run_script', 'A few lines of code'], ['log', 'Write to the run log']] }
];

export const STEP_MENU: MenuGroup<StepType>[] = STEP_GROUPS.map((g) => ({
  label: g.label,
  items: g.items.map(([value, hint]) => ({ value, label: STEP_LABELS[value], hint }))
}));

export type TemplateId = 'blank' | 'command' | 'timer' | 'raid' | 'deaths';

export const TEMPLATE_MENU: MenuGroup<TemplateId>[] = [
  {
    items: [
      { value: 'blank', label: 'Blank action' },
      { value: 'command', label: 'Chat command', hint: '!discord posts a link' },
      { value: 'timer', label: 'Timer message', hint: 'Posts every 15 minutes while live' },
      { value: 'raid', label: 'Raid welcome', hint: 'Thanks raiders and shouts them out' },
      { value: 'deaths', label: 'Deaths counter', hint: '!death adds one and posts the total' }
    ]
  }
];

export function fromTemplate(id: TemplateId): Action {
  switch (id) {
    case 'blank':
      return newAction();
    case 'command':
      return chained(
        { name: '!discord', group: 'Chat commands', cooldown_s: 5 },
        [{ type: 'command', name: 'discord', aliases: [], permission: 'everyone', user_cooldown_s: 30 }],
        [{ type: 'chat_send', message: 'Join the Discord: https://discord.gg/your-invite', as_bot: true, reply: true }]
      );
    case 'timer':
      return chained(
        { name: 'Timer message', group: 'Timers' },
        [{ type: 'timer', interval_s: 15 * 60, only_when_live: true, min_chat_lines: 5 }],
        [{ type: 'chat_send', message: 'Enjoying the stream? Follow so you know when I go live!', as_bot: true, reply: false }]
      );
    case 'raid':
      return chained(
        { name: 'Raid welcome', group: 'Stream events', cooldown_s: 30 },
        [{ type: 'event', kind: 'raid', conditions: { mode: 'all', conditions: [{ field: 'amount', op: 'gte', value: 5 }] } }],
        [
          { type: 'delay', ms: 3000 },
          { type: 'chat_announce', message: 'Welcome {{name}} and the {{amount}} raiders!', color: 'purple' },
          { type: 'shoutout', user: '{{user.login}}', message: '' }
        ]
      );
    case 'deaths':
      return chained(
        { name: 'Deaths counter', group: 'Chat commands' },
        [{ type: 'command', name: 'death', aliases: [], permission: 'moderator', user_cooldown_s: 0 }],
        [
          { type: 'add_to_variable', key: 'counter.deaths', amount: 1, persist: true },
          { type: 'chat_send', message: 'Deaths: {{counter.deaths}}', as_bot: true, reply: false }
        ]
      );
  }
}

/** Event kinds an event trigger can listen to (chat is a command trigger). */
export function triggerKinds(all: readonly EventKind[]): EventKind[] {
  return all.filter((k) => k !== 'chat');
}

export const ANNOUNCE_COLORS = ['primary', 'blue', 'green', 'orange', 'purple'] as const;
