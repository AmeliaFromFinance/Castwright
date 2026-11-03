import type { Action } from '$lib/bindings/Action';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { KIND_LABELS } from '$lib/format';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Toggle } from '$lib/bindings/Toggle';
import { describeConditions } from '$lib/editors/conditions';
import type { Token } from '$lib/editors/tokens';
import { tokensFor } from '../alerts/alerts';
import { TRIGGER_LABELS } from './defaults';
import { commandName } from './validate';
import { MODE_LABELS } from '$lib/widgets/chat/moderation';

export function every(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s % 3600 === 0 && s >= 3600) return `${s / 3600} h`;
  if (s % 60 === 0 && s >= 60) return `${s / 60} min`;
  if (s > 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${s} s`;
}

export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'command':
      return commandName(t.name) ? `!${commandName(t.name)}` : 'Chat command';
    case 'event':
      return KIND_LABELS[t.kind];
    case 'timer':
      return `Every ${every(t.interval_s)}`;
    case 'scene_changed':
      return t.scene ? `Scene: ${t.scene}` : 'Any scene change';
    case 'redemption':
      return t.reward_title.trim() ? `Redeem: ${t.reward_title.trim()}` : 'Any reward redeemed';
    default:
      return TRIGGER_LABELS[t.type];
  }
}

export function describeTriggers(a: Action): string {
  if (!a.triggers.length) return 'No trigger';
  return a.triggers.map(describeTrigger).join(', ');
}

function templates(steps: readonly Step[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'string' && k !== 'type') out.push(v);
    }
    if (s.type === 'if') out.push(...s.conditions.conditions.map((c) => c.field));
  }
  return out;
}

/** `!so <arg1>` style example of how viewers use a command. */
export function commandPreview(name: string, steps: readonly Step[]): string {
  const text = templates(steps).join('\n');
  let max = 0;
  for (const m of text.matchAll(/\barg(\d+)\b/g)) max = Math.max(max, Number(m[1]));
  const parts = [`!${commandName(name) || 'command'}`];
  for (let i = 1; i <= Math.min(max, 6); i++) parts.push(i === 1 && /\b(shoutout|timeout_user)\b/.test(JSON.stringify(steps)) ? '@user' : `<arg${i}>`);
  if (max === 0 && /\binput\b/.test(text)) parts.push('<text>');
  return parts.join(' ');
}

const COMMAND_TOKENS: Token[] = [
  { token: 'name', label: 'Who typed it' },
  { token: 'user.login', label: 'Their login' },
  { token: 'arg1', label: 'First word after the command' },
  { token: 'arg2', label: 'Second word' },
  { token: 'input', label: 'Everything after the command' }
];

const REDEMPTION_TOKENS: Token[] = [
  { token: 'user', label: 'Who redeemed it' },
  { token: 'reward', label: 'Reward title' },
  { token: 'cost', label: 'Points spent' },
  { token: 'input', label: 'Their message' }
];

const POLL_TOKENS: Token[] = [
  { token: 'poll.title', label: 'Poll question' },
  { token: 'poll.choices', label: 'All choices' },
  { token: 'poll.winner', label: 'Winning choice (at the end)' },
  { token: 'poll.winner_votes', label: 'Votes for the winner' },
  { token: 'poll.total_votes', label: 'Votes in total' }
];

const PREDICTION_TOKENS: Token[] = [
  { token: 'prediction.title', label: 'Prediction question' },
  { token: 'prediction.outcomes', label: 'All outcomes' },
  { token: 'prediction.winner', label: 'Winning outcome (at the end)' },
  { token: 'prediction.total_points', label: 'Points in total' },
  { token: 'prediction.total_users', label: 'Viewers who predicted' }
];

/** Extra values redemption, poll and prediction events give an action. */
function interactTokens(kind: string): Token[] {
  if (kind === 'redemption') return REDEMPTION_TOKENS;
  if (kind.startsWith('poll_')) return POLL_TOKENS;
  if (kind.startsWith('prediction_')) return PREDICTION_TOKENS;
  return [];
}

/** Template chips for an action, based on what its triggers provide. */
export function tokensForAction(a: Action): Token[] {
  const out: Token[] = [];
  const add = (t: Token) => {
    if (!out.some((x) => x.token === t.token)) out.push(t);
  };
  for (const t of a.triggers) {
    if (t.type === 'command') COMMAND_TOKENS.forEach(add);
    else if (t.type === 'event') [...tokensFor(t.kind), ...interactTokens(t.kind)].forEach(add);
    else if (t.type === 'scene_changed') add({ token: 'scene', label: 'New scene' });
    else interactTokens(t.type).forEach(add);
  }
  add({ token: 'stream.title', label: 'Stream title' });
  add({ token: 'stream.uptime_text', label: 'Time live' });
  return out;
}

/** Condition fields for if-steps: trigger data plus a few common variables. */
export function fieldsForAction(a: Action, vars: Record<string, unknown>): Array<{ value: string; label: string }> {
  const fields = tokensForAction(a).map((t) => ({ value: t.token.split('|')[0]!.trim(), label: t.label ?? t.token }));
  for (const t of a.triggers) {
    if (t.type === 'command') {
      fields.push({ value: 'arg_count', label: 'Number of words after the command' });
      fields.push({ value: 'roles.moderator', label: 'Is a moderator' }, { value: 'roles.subscriber', label: 'Is a subscriber' });
    }
  }
  for (const k of Object.keys(vars).sort()) if (!fields.some((f) => f.value === k)) fields.push({ value: k, label: 'Variable' });
  return fields;
}

const TOGGLE: Record<Toggle, [string, string]> = { on: ['Show', 'Mute'], off: ['Hide', 'Unmute'], toggle: ['Toggle', 'Toggle mute'] };
const quote = (s: string) => (s.trim() ? `“${s.trim()}”` : '');
const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;

/** One plain line about what a step does. Empty when it isn't set up yet. */
export function describeStep(s: Step, ctx: { actions?: readonly Action[]; overlays?: readonly Overlay[] } = {}): string {
  switch (s.type) {
    case 'chat_send':
    case 'chat_announce':
    case 'log':
      return s.message.trim();
    case 'shoutout':
      return s.user.trim() ? `Shout out ${s.user.trim()}` : '';
    case 'create_clip':
      return 'Clip the last 30 seconds';
    case 'create_marker':
      return s.description.trim() || 'Mark this moment';
    case 'run_ad':
      return `${s.length_s} second ad`;
    case 'set_stream_info':
      return [s.title.trim() && `Title ${quote(s.title)}`, s.category.trim() && `Category ${quote(s.category)}`].filter(Boolean).join(' · ');
    case 'timeout_user':
      return s.user.trim() ? `${s.user.trim()} for ${every(s.duration_s)}` : '';
    case 'delete_message':
      return s.message_id.trim() ? `Message ${s.message_id.trim()}` : 'The message that started this';
    case 'set_chat_mode': {
      const name = MODE_LABELS[s.mode];
      if (s.state === 'toggle') return `Toggle ${name.toLowerCase()}`;
      if (s.state === 'off') return `${name} off`;
      if (s.mode === 'slow') return `${name} on, ${s.value || 30} s`;
      if (s.mode === 'followers') return `${name} on${s.value ? `, ${every(s.value * 60)}` : ''}`;
      return `${name} on`;
    }
    case 'delay':
      return `Wait ${seconds(s.ms)}`;
    case 'set_variable':
      return s.key ? `${s.key} = ${s.value || '""'}` : '';
    case 'add_to_variable':
      return s.key ? `${s.key} ${s.amount < 0 ? '−' : '+'} ${Math.abs(s.amount)}` : '';
    case 'switch_scene':
      return s.scene ? `Go to ${quote(s.scene)}` : '';
    case 'set_source_visible':
      return s.source ? `${TOGGLE[s.state][0]} ${quote(s.source)}${s.scene ? ` in ${quote(s.scene)}` : ''}` : '';
    case 'set_input_mute':
      return s.input ? `${TOGGLE[s.state][1]} ${quote(s.input)}` : '';
    case 'recording':
      return { on: 'Start recording', off: 'Stop recording', toggle: 'Start or stop recording' }[s.state];
    case 'save_replay':
      return 'Save the replay buffer';
    case 'set_layer_visible': {
      const ov = ctx.overlays?.find((o) => o.id === s.overlay_id);
      const layer = ov?.layers.find((l) => l.id === s.layer_id);
      return ov && layer ? `${TOGGLE[s.state][0]} ${quote(layer.name)} in ${ov.name}` : '';
    }
    case 'play_alert':
      return s.title.trim() || s.message.trim();
    case 'pause_alerts':
      return { on: 'Pause the alert queue', off: 'Resume the alert queue', toggle: 'Pause or resume alerts' }[s.state];
    case 'skip_alert':
      return 'End the alert on screen';
    case 'play_sound':
      return s.src ? `${s.src.split('/').pop()} at ${s.volume}%` : '';
    case 'http_request':
      return s.url.trim() ? `${s.method.toUpperCase()} ${s.url.trim()}` : '';
    case 'run_script':
      return s.code.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('//')) ?? '';
    case 'if':
      return describeConditions(s.conditions, 'Always true');
    case 'run_action': {
      const a = ctx.actions?.find((x) => x.id === s.action_id);
      return a ? `Run ${quote(a.name)}` : '';
    }
    case 'stop':
      return 'End this run';
    case 'finish_redemption':
      return s.refund ? 'Refund the points' : 'Mark it complete';
    case 'set_reward_state': {
      const verb = { enable: 'Turn on', disable: 'Turn off', pause: 'Pause', resume: 'Resume' }[s.state];
      return s.reward_title.trim() ? `${verb} ${quote(s.reward_title)}` : '';
    }
    case 'set_reward_cost':
      return s.reward_title.trim() && s.cost.trim() ? `${quote(s.reward_title)} costs ${s.cost.trim()}` : '';
    case 'start_poll':
      return s.title.trim() ? `${quote(s.title)} for ${every(s.duration_s)}` : '';
    case 'end_poll':
      return 'End the poll and show the result';
    case 'start_prediction':
      return s.title.trim() ? `${quote(s.title)}, open ${every(s.window_s)}` : '';
    case 'end_prediction':
      if (s.action === 'lock') return 'Lock the prediction';
      if (s.action === 'cancel') return 'Cancel and refund';
      return s.winner.trim() ? `${quote(s.winner)} wins` : '';
  }
}
