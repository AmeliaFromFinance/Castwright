import {
  Bell,
  BellOff,
  Bookmark,
  Braces,
  Clapperboard,
  Clock,
  Code,
  Command,
  Eye,
  Globe,
  Hand,
  Hash,
  Hourglass,
  Layers,
  Megaphone,
  MessageSquare,
  MicOff,
  MonitorPlay,
  OctagonX,
  Radio,
  RadioTower,
  Repeat,
  Scissors,
  ScrollText,
  SkipForward,
  Split,
  Sparkles,
  Tv,
  Type,
  UserX,
  Variable,
  Volume2,
  Workflow,
  Zap
} from '@lucide/svelte';
import type { Component } from 'svelte';
import { STEP_GROUPS, type StepType, type TriggerType } from './defaults';

type Icon = Component<{ size?: number | string }>;

export const STEP_ICONS: Record<StepType, Icon> = {
  chat_send: MessageSquare,
  chat_announce: Megaphone,
  shoutout: Sparkles,
  create_clip: Scissors,
  create_marker: Bookmark,
  run_ad: Tv,
  set_stream_info: Type,
  timeout_user: UserX,
  delay: Hourglass,
  set_variable: Variable,
  add_to_variable: Hash,
  switch_scene: Clapperboard,
  set_source_visible: Eye,
  set_input_mute: MicOff,
  recording: Radio,
  save_replay: Repeat,
  set_layer_visible: Layers,
  play_alert: Bell,
  pause_alerts: BellOff,
  skip_alert: SkipForward,
  play_sound: Volume2,
  http_request: Globe,
  run_script: Code,
  if: Split,
  run_action: Workflow,
  stop: OctagonX,
  log: ScrollText
};

export const TRIGGER_ICONS: Record<TriggerType, Icon> = {
  event: Zap,
  command: Command,
  timer: Clock,
  stream_online: Radio,
  stream_offline: RadioTower,
  scene_changed: MonitorPlay,
  manual: Hand
};

/** Colour family of a step, from its menu group. */
export type Tone = 'chat' | 'twitch' | 'obs' | 'media' | 'vars' | 'logic' | 'advanced';

const TONES: Record<string, Tone> = {
  Chat: 'chat',
  Twitch: 'twitch',
  OBS: 'obs',
  'Overlays & alerts': 'media',
  Variables: 'vars',
  Logic: 'logic',
  Advanced: 'advanced'
};

export function stepTone(type: StepType): Tone {
  const g = STEP_GROUPS.find((x) => x.items.some(([t]) => t === type));
  return TONES[g?.label ?? ''] ?? 'advanced';
}

export const GROUP_ICONS: Record<string, Icon> = {
  Chat: MessageSquare,
  Twitch: Tv,
  OBS: Clapperboard,
  'Overlays & alerts': Layers,
  Variables: Variable,
  Logic: Split,
  Advanced: Braces
};
