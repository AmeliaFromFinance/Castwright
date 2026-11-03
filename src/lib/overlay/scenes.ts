// Scene rules: which OBS scenes show a layer, and how it comes and goes on a scene change.
import type { AnimPreset } from '$lib/bindings/AnimPreset';
import type { Animation } from '$lib/bindings/Animation';
import type { Layer } from '$lib/bindings/Layer';
import type { SceneRule } from '$lib/bindings/SceneRule';
import type { SceneTransition } from '$lib/bindings/SceneTransition';
import { hasAnimation } from './anim';

export const SCENE_VAR = 'obs.scene';

export function defaultSceneRule(): SceneRule {
  return { mode: 'all', scenes: [], transition: 'fade', duration_ms: 300 };
}

/** The program scene from the live variables, or '' when OBS isn't connected. */
export function currentScene(vars: Record<string, unknown>): string {
  const s = vars[SCENE_VAR];
  return typeof s === 'string' ? s : '';
}

export function hasSceneRule(rule: SceneRule | null | undefined): boolean {
  return !!rule && rule.mode !== 'all';
}

/** Same as SceneRule::allows in Rust. An unknown scene ('') shows every layer. */
export function sceneAllows(rule: SceneRule | null | undefined, scene: string): boolean {
  if (!rule || !scene) return true;
  const listed = (rule.scenes ?? []).includes(scene);
  if (rule.mode === 'only') return listed;
  if (rule.mode === 'hide') return !listed;
  return true;
}

/** Manual or automation visibility on its own, before conditions and scenes. */
export function baseVisible(l: Layer, overrides: Record<string, boolean>): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, l.id) ? !!overrides[l.id] : l.visible;
}

/** Short text for the layer list badge. */
export function sceneBadge(rule: SceneRule | null | undefined): string | null {
  if (!rule || !hasSceneRule(rule)) return null;
  const n = rule.scenes.length;
  if (rule.mode === 'only') return n === 1 ? `Only ${rule.scenes[0]}` : `Only ${n} scenes`;
  return n === 1 ? `Not in ${rule.scenes[0]}` : `Hidden in ${n} scenes`;
}

const PRESET: Record<SceneTransition, AnimPreset> = { none: 'none', fade: 'fade', slide: 'slide_up', scale: 'zoom' };

/**
 * The animation a layer with a scene rule plays when it shows or hides: its own enter or
 * exit animation, else the rule's transition. With reduced motion, movement becomes a fade.
 */
export function sceneAnimation(l: Layer, phase: 'enter' | 'exit', reduced: boolean): Animation {
  const own = phase === 'enter' ? l.enter : l.exit;
  const rule = l.scenes;
  const a: Animation =
    hasAnimation(own) || !rule
      ? own
      : { preset: PRESET[rule.transition] ?? 'fade', duration_ms: rule.duration_ms, delay_ms: 0, easing: 'ease_out' };
  return reduced && hasAnimation(a) && a.preset !== 'fade' ? { ...a, preset: 'fade' } : a;
}

/** The viewer asked for less motion, in the browser or in Castwright's settings. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.reduceMotion === 'true') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** OBS scenes first, in OBS order, then names only typed into layer rules. */
export function knownScenes(obsScenes: readonly string[], layers: readonly Layer[]): string[] {
  const out = [...new Set(obsScenes.filter(Boolean))];
  for (const l of layers) for (const s of l.scenes?.scenes ?? []) if (s && !out.includes(s)) out.push(s);
  return out;
}
