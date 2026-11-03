import { describe, expect, it } from 'vitest';
import type { SceneRule } from '$lib/bindings/SceneRule';
import { baseVisible, currentScene, hasSceneRule, knownScenes, sceneAllows, sceneAnimation, sceneBadge } from './scenes';
import { layer } from './test/fixtures';

const rule = (mode: SceneRule['mode'], scenes: string[] = []): SceneRule => ({ mode, scenes, transition: 'fade', duration_ms: 300 });

describe('scene rules', () => {
  it('only, hide and all', () => {
    expect(sceneAllows(rule('only', ['Gameplay']), 'Gameplay')).toBe(true);
    expect(sceneAllows(rule('only', ['Gameplay']), 'BRB')).toBe(false);
    expect(sceneAllows(rule('hide', ['Gameplay']), 'Gameplay')).toBe(false);
    expect(sceneAllows(rule('hide', ['Gameplay']), 'BRB')).toBe(true);
    expect(sceneAllows(rule('all', ['Gameplay']), 'BRB')).toBe(true);
    expect(sceneAllows(rule('only', []), 'BRB')).toBe(false);
  });

  it('names match exactly', () => {
    expect(sceneAllows(rule('only', ['Gameplay']), 'gameplay')).toBe(false);
  });

  it('shows everything when the scene is unknown or the rule is missing', () => {
    expect(sceneAllows(rule('only', ['Gameplay']), '')).toBe(true);
    expect(sceneAllows(undefined, 'BRB')).toBe(true);
    expect(currentScene({})).toBe('');
    expect(currentScene({ 'obs.scene': 'BRB' })).toBe('BRB');
    expect(currentScene({ 'obs.scene': 3 })).toBe('');
  });

  it('manual and automation visibility come first', () => {
    const l = layer({ type: 'alerts' }, { visible: false });
    expect(baseVisible(l, {})).toBe(false);
    expect(baseVisible(l, { [l.id]: true })).toBe(true);
    expect(baseVisible({ ...l, visible: true }, { [l.id]: false })).toBe(false);
  });

  it('badges', () => {
    expect(hasSceneRule(rule('all'))).toBe(false);
    expect(sceneBadge(rule('all'))).toBeNull();
    expect(sceneBadge(rule('only', ['BRB']))).toBe('Only BRB');
    expect(sceneBadge(rule('hide', ['A', 'B']))).toBe('Hidden in 2 scenes');
  });

  it('known scenes keep OBS order and add typed names', () => {
    const l = layer({ type: 'alerts' }, { scenes: rule('only', ['Gameplay', 'Old scene']) });
    expect(knownScenes(['Starting', 'Gameplay'], [l])).toEqual(['Starting', 'Gameplay', 'Old scene']);
  });
});

describe('scene animations', () => {
  it("uses the layer's own animation first", () => {
    const l = layer({ type: 'alerts' }, { enter: { preset: 'slide_up', duration_ms: 500, delay_ms: 0, easing: 'ease_out' }, scenes: rule('only', ['A']) });
    expect(sceneAnimation(l, 'enter', false).preset).toBe('slide_up');
    expect(sceneAnimation(l, 'exit', false).preset).toBe('fade');
  });

  it('maps the transition and its duration', () => {
    const l = layer({ type: 'alerts' }, { scenes: { ...rule('only', ['A']), transition: 'scale', duration_ms: 800 } });
    expect(sceneAnimation(l, 'enter', false)).toMatchObject({ preset: 'zoom', duration_ms: 800 });
    const none = layer({ type: 'alerts' }, { scenes: { ...rule('only', ['A']), transition: 'none' } });
    expect(sceneAnimation(none, 'exit', false).preset).toBe('none');
  });

  it('reduced motion turns movement into a fade', () => {
    const l = layer({ type: 'alerts' }, { scenes: { ...rule('only', ['A']), transition: 'slide' } });
    expect(sceneAnimation(l, 'enter', true).preset).toBe('fade');
    const none = layer({ type: 'alerts' }, { scenes: { ...rule('only', ['A']), transition: 'none' } });
    expect(sceneAnimation(none, 'enter', true).preset).toBe('none');
  });
});
