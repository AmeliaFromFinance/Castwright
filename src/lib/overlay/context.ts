import { getContext, setContext } from 'svelte';
import type { ChatRules } from '$lib/bindings/ChatRules';
import type { Credits } from '$lib/bindings/Credits';
import type { Event } from '$lib/bindings/Event';
import type { TimerRun } from '$lib/bindings/TimerRun';
import type { OverlayFeed } from './feed';
import type { ActiveAlert, WidgetState } from './state';

export type StageMode = 'live' | 'editor';

export type WidgetStoreFn = (layerId: string, key: string, value: unknown) => void;

/** What every layer renderer can read. Getters, so reads stay reactive. */
export interface StageCtx {
  readonly vars: Record<string, unknown>;
  readonly recent: readonly Event[];
  readonly chat: readonly Event[];
  /** The app's chat rules; null outside the app and before the first hello. */
  readonly chatRules: ChatRules | null;
  readonly alert: ActiveAlert | null;
  readonly widgetState: WidgetState;
  readonly mode: StageMode;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly feed: OverlayFeed | undefined;
  /** Names for credits layers; null until loaded. */
  readonly credits: Credits | null;
  /** Times each credits layer was told to roll. */
  readonly rolls: Readonly<Record<string, number>>;
  /** Started, paused or reset timer layers, by layer id. */
  readonly timers: Readonly<Record<string, TimerRun>>;
  /** Ask for fresh credits names. */
  loadCredits(): void;
  /** The alerts layer that plays sound (the first one that's shown). */
  readonly audioLayerId: string | null;
  assetUrl(path: string): string;
  /** `value` undefined means delete. */
  storeWidgetValue(layerId: string, key: string, value: unknown): void;
}

const KEY = Symbol('castwright-stage');

export function setStageCtx(ctx: StageCtx): void {
  setContext(KEY, ctx);
}

export function getStageCtx(): StageCtx {
  const ctx = getContext<StageCtx | undefined>(KEY);
  if (!ctx) throw new Error('Layer rendered outside OverlayStage');
  return ctx;
}
