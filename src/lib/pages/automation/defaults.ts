// Defaults for new triggers, steps and actions. Values follow the Rust model
// (src-tauri/src/model/automation.rs): serde defaults where they exist, and a
// sensible starting value for required fields.
import type { Action } from '$lib/bindings/Action';
import type { EventKind } from '$lib/bindings/EventKind';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { newId } from '$lib/editors/ids';
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
    case 'redemption':
      return { type, reward_id: '', reward_title: '' };
    case 'ad_soon':
      return { type, minutes_before: 1 };
    case 'ad_begin':
    case 'ad_end':
    case 'song_changed':
    case 'stream_online':
    case 'stream_offline':
    case 'manual':
    case 'poll_begin':
    case 'poll_end':
    case 'prediction_begin':
    case 'prediction_end':
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
    case 'skip_alert':
    case 'stop':
    case 'end_poll':
    case 'snooze_ad':
      return { type };
    case 'post_to_discord':
      return { type, webhook_id: '', message: '' };
    case 'finish_redemption':
      return { type, refund: false };
    case 'set_reward_state':
      return { type, reward_id: '', reward_title: '', state: 'pause' };
    case 'set_reward_cost':
      return { type, reward_id: '', reward_title: '', cost: '' };
    case 'start_poll':
      return { type, title: '', choices: ['', ''], duration_s: 120, points_per_vote: 0 };
    case 'start_prediction':
      return { type, title: '', outcomes: ['', ''], window_s: 120 };
    case 'end_prediction':
      return { type, action: 'lock', winner: '' };
    case 'create_marker':
      return { type, description: '' };
    case 'run_ad':
      return { type, length_s: 30 };
    case 'set_stream_info':
      return { type, title: '', category: '' };
    case 'timeout_user':
      return { type, user: '', duration_s: 60, reason: '' };
    case 'delete_message':
      return { type, message_id: '' };
    case 'set_chat_mode':
      return { type, mode: 'slow', state: 'on', value: 0 };
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
    case 'roll_credits':
      return { type, overlay_id: '', layer_id: '' };
    case 'play_alert':
      return { type, title: '', message: '', image: '', sound: '', duration_ms: 6000 };
    case 'pause_alerts':
      return { type, state: 'on' };
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
    graph: { nodes: [], edges: [], notes: [], frames: [] },
    cooldown_s: 0,
    ...patch
  };
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  event: 'Twitch event',
  command: 'Chat command',
  timer: 'Timer',
  stream_online: 'Stream goes live',
  stream_offline: 'Stream ends',
  scene_changed: 'Scene changes',
  manual: 'Button or Stream Deck',
  redemption: 'Channel point redemption',
  poll_begin: 'Poll starts',
  poll_end: 'Poll ends',
  prediction_begin: 'Prediction starts',
  prediction_end: 'Prediction ends',
  ad_soon: 'Ad starting soon',
  ad_begin: 'Ad break begins',
  ad_end: 'Ad break ends',
  song_changed: 'Song changes'
};

export const TRIGGER_MENU: MenuGroup<TriggerType>[] = [
  {
    items: [
      { value: 'command', label: 'Chat command', hint: 'Someone types !command' },
      { value: 'event', label: 'Twitch event', hint: 'Follow, sub, raid, hype train…' },
      { value: 'redemption', label: 'Channel point redemption', hint: 'One reward or any' },
      { value: 'poll_begin', label: 'Poll starts' },
      { value: 'poll_end', label: 'Poll ends', hint: 'With the winning choice' },
      { value: 'prediction_begin', label: 'Prediction starts' },
      { value: 'prediction_end', label: 'Prediction ends', hint: 'Resolved or canceled' },
      { value: 'ad_soon', label: 'Ad starting soon', hint: 'Some minutes before the next ad' },
      { value: 'ad_begin', label: 'Ad break begins' },
      { value: 'ad_end', label: 'Ad break ends' },
      { value: 'timer', label: 'Timer', hint: 'Every few minutes' },
      { value: 'stream_online', label: 'Stream goes live' },
      { value: 'stream_offline', label: 'Stream ends' },
      { value: 'scene_changed', label: 'Scene changes', hint: 'In OBS' },
      { value: 'song_changed', label: 'Song changes', hint: 'From Settings → Music' },
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
  create_marker: 'Add stream marker',
  run_ad: 'Run ad',
  set_stream_info: 'Set stream info',
  timeout_user: 'Time out user',
  delete_message: 'Delete message',
  set_chat_mode: 'Set chat mode',
  delay: 'Wait',
  set_variable: 'Set variable',
  add_to_variable: 'Add to variable',
  switch_scene: 'Switch scene',
  set_source_visible: 'Show/hide source',
  set_input_mute: 'Mute/unmute',
  recording: 'Recording',
  save_replay: 'Save replay',
  set_layer_visible: 'Show/hide overlay layer',
  roll_credits: 'Roll credits',
  play_alert: 'Play alert',
  pause_alerts: 'Pause alerts',
  skip_alert: 'Skip alert',
  play_sound: 'Play sound',
  http_request: 'Web request',
  run_script: 'Run script',
  if: 'If',
  run_action: 'Run action',
  finish_redemption: 'Complete or refund redemption',
  set_reward_state: 'Enable or pause reward',
  set_reward_cost: 'Change reward cost',
  start_poll: 'Start poll',
  end_poll: 'End poll',
  start_prediction: 'Start prediction',
  end_prediction: 'Lock or resolve prediction',
  snooze_ad: 'Snooze ad',
  post_to_discord: 'Post to Discord',
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
      ['snooze_ad', 'Push the next ad back 5 minutes'],
      ['set_stream_info', 'Title and category'],
      ['timeout_user'],
      ['delete_message', 'The message that started the action'],
      ['set_chat_mode', 'Slow, followers-only, shield…']
    ]
  },
  {
    label: 'Points & polls',
    items: [
      ['finish_redemption', 'The redemption that started it'],
      ['set_reward_state', 'Turn a reward on, off or pause it'],
      ['set_reward_cost'],
      ['start_poll'],
      ['end_poll', 'End it early, show the result'],
      ['start_prediction'],
      ['end_prediction', 'Lock, pick the winner or cancel']
    ]
  },
  {
    label: 'OBS',
    items: [['switch_scene'], ['set_source_visible'], ['set_input_mute'], ['recording', 'Start, stop or toggle'], ['save_replay']]
  },
  {
    label: 'Overlays & alerts',
    items: [
      ['set_layer_visible'],
      ['roll_credits', 'Start a credits layer from the top'],
      ['play_alert', 'Queue a custom alert'],
      ['pause_alerts', 'Pause or resume the queue'],
      ['skip_alert', 'End the alert on screen'],
      ['play_sound']
    ]
  },
  { label: 'Variables', items: [['set_variable'], ['add_to_variable', 'Counters, totals']] },
  { label: 'Discord', items: [['post_to_discord', 'Send a message with a webhook']] },
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

/** Event kinds an event trigger can listen to. Chat is last: commands cover most uses. */
export function triggerKinds(all: readonly EventKind[]): EventKind[] {
  return [...all.filter((k) => k !== 'chat'), 'chat'];
}

export const REWARD_STATES = [
  ['enable', 'Turn on'],
  ['disable', 'Turn off'],
  ['pause', 'Pause'],
  ['resume', 'Resume']
] as const;

export const ANNOUNCE_COLORS = ['primary', 'blue', 'green', 'orange', 'purple'] as const;
