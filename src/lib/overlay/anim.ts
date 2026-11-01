import type { AnimPreset } from '$lib/bindings/AnimPreset';
import type { Animation as Anim } from '$lib/bindings/Animation';
import type { Easing } from '$lib/bindings/Easing';

export type Phase = 'enter' | 'exit' | 'idle';

export const DEFAULT_MS: Record<Phase, number> = { enter: 450, exit: 350, idle: 2400 };

/** CSS easing for a phase. Back and spring are cubic-bezier overshoot curves (Chrome 103 has no `linear()`). */
export function easingCss(easing: Easing, phase: Phase): string {
  switch (easing) {
    case 'linear':
      return 'linear';
    case 'ease_in':
      return 'cubic-bezier(0.55, 0, 1, 0.45)';
    case 'ease_out':
      return 'cubic-bezier(0.22, 1, 0.36, 1)';
    case 'ease_in_out':
      return 'cubic-bezier(0.65, 0, 0.35, 1)';
    case 'back':
      return phase === 'exit' ? 'cubic-bezier(0.36, 0, 0.66, -0.56)' : 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    case 'spring':
      return phase === 'exit' ? 'cubic-bezier(0.6, -0.28, 0.735, 0.045)' : 'cubic-bezier(0.18, 1.25, 0.4, 1.1)';
  }
}

export interface AnimSpec {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

/** Slide distance for a layer of this size. */
export function slideDistance(w: number, h: number, vertical: boolean): number {
  const size = vertical ? h : w;
  return Math.round(Math.min(160, Math.max(28, size * 0.3)));
}

function enterFrames(preset: AnimPreset, w: number, h: number): Keyframe[] | null {
  const dy = slideDistance(w, h, true);
  const dx = slideDistance(w, h, false);
  switch (preset) {
    case 'none':
      return null;
    case 'fade':
      return [{ opacity: 0 }, { opacity: 1 }];
    case 'slide_up':
      return [
        { opacity: 0, transform: `translate3d(0, ${dy}px, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ];
    case 'slide_down':
      return [
        { opacity: 0, transform: `translate3d(0, ${-dy}px, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ];
    case 'slide_left':
      return [
        { opacity: 0, transform: `translate3d(${dx}px, 0, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ];
    case 'slide_right':
      return [
        { opacity: 0, transform: `translate3d(${-dx}px, 0, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ];
    case 'zoom':
      return [
        { opacity: 0, transform: 'scale(0.6)' },
        { opacity: 1, transform: 'scale(1)' }
      ];
    case 'pop':
      return [
        { opacity: 0, transform: 'scale(0.4)', offset: 0 },
        { opacity: 1, transform: 'scale(1.08)', offset: 0.65 },
        { opacity: 1, transform: 'scale(0.98)', offset: 0.85 },
        { opacity: 1, transform: 'scale(1)', offset: 1 }
      ];
    case 'bounce':
      return [
        { opacity: 0, transform: `translate3d(0, ${-dy}px, 0)`, offset: 0 },
        { opacity: 1, transform: 'translate3d(0, 0, 0)', offset: 0.5 },
        { transform: `translate3d(0, ${-dy * 0.22}px, 0)`, offset: 0.7 },
        { transform: 'translate3d(0, 0, 0)', offset: 0.85 },
        { transform: `translate3d(0, ${-dy * 0.06}px, 0)`, offset: 0.93 },
        { opacity: 1, transform: 'translate3d(0, 0, 0)', offset: 1 }
      ];
    case 'flip':
      return [
        { opacity: 0, transform: 'perspective(900px) rotateX(-80deg)' },
        { opacity: 1, transform: 'perspective(900px) rotateX(0deg)' }
      ];
    case 'pulse':
      return [
        { opacity: 0, transform: 'scale(0.9)', offset: 0 },
        { opacity: 1, transform: 'scale(1.06)', offset: 0.6 },
        { opacity: 1, transform: 'scale(1)', offset: 1 }
      ];
    case 'float':
      return [
        { opacity: 0, transform: `translate3d(0, ${Math.round(dy / 2)}px, 0) scale(0.98)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
      ];
    case 'shake':
      return [
        { opacity: 0, transform: 'translate3d(0, 0, 0)', offset: 0 },
        { opacity: 1, transform: 'translate3d(-10px, 0, 0)', offset: 0.2 },
        { transform: 'translate3d(9px, 0, 0)', offset: 0.35 },
        { transform: 'translate3d(-6px, 0, 0)', offset: 0.5 },
        { transform: 'translate3d(4px, 0, 0)', offset: 0.65 },
        { transform: 'translate3d(-2px, 0, 0)', offset: 0.8 },
        { opacity: 1, transform: 'translate3d(0, 0, 0)', offset: 1 }
      ];
    case 'spin':
      return [
        { opacity: 0, transform: 'rotate(-180deg) scale(0.5)' },
        { opacity: 1, transform: 'rotate(0deg) scale(1)' }
      ];
  }
}

function exitFrames(preset: AnimPreset, w: number, h: number): Keyframe[] | null {
  const dy = slideDistance(w, h, true);
  const dx = slideDistance(w, h, false);
  // Slides keep moving the same way; the rest play their entrance backwards.
  switch (preset) {
    case 'slide_up':
      return [
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        { opacity: 0, transform: `translate3d(0, ${-dy}px, 0)` }
      ];
    case 'slide_down':
      return [
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        { opacity: 0, transform: `translate3d(0, ${dy}px, 0)` }
      ];
    case 'slide_left':
      return [
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        { opacity: 0, transform: `translate3d(${-dx}px, 0, 0)` }
      ];
    case 'slide_right':
      return [
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        { opacity: 0, transform: `translate3d(${dx}px, 0, 0)` }
      ];
    case 'bounce':
      return [
        { opacity: 1, transform: 'translate3d(0, 0, 0)', offset: 0 },
        { opacity: 1, transform: `translate3d(0, ${-dy * 0.25}px, 0)`, offset: 0.35 },
        { opacity: 0, transform: `translate3d(0, ${dy}px, 0)`, offset: 1 }
      ];
    default: {
      const f = enterFrames(preset, w, h);
      if (!f) return null;
      return f
        .slice()
        .reverse()
        .map((k) => (k.offset === undefined ? { ...k } : { ...k, offset: 1 - (k.offset as number) }));
    }
  }
}

function idleFrames(preset: AnimPreset, w: number, h: number): Keyframe[] | null {
  const drift = Math.min(10, Math.max(4, Math.round(Math.min(w, h) * 0.04)));
  switch (preset) {
    case 'none':
      return null;
    case 'fade':
      return [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }];
    case 'pulse':
      return [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }];
    case 'zoom':
      return [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }];
    case 'pop':
      return [
        { transform: 'scale(1)', offset: 0 },
        { transform: 'scale(1.08)', offset: 0.08 },
        { transform: 'scale(1)', offset: 0.18 },
        { transform: 'scale(1)', offset: 1 }
      ];
    case 'float':
      return [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: `translate3d(0, ${-drift}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
      ];
    case 'slide_up':
    case 'slide_down': {
      const s = preset === 'slide_up' ? -drift : drift;
      return [{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(0, ${s}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }];
    }
    case 'slide_left':
    case 'slide_right': {
      const s = preset === 'slide_left' ? -drift : drift;
      return [{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(${s}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }];
    }
    case 'bounce':
      return [
        { transform: 'translate3d(0, 0, 0)', offset: 0 },
        { transform: `translate3d(0, ${-drift * 1.6}px, 0)`, offset: 0.15 },
        { transform: 'translate3d(0, 0, 0)', offset: 0.3 },
        { transform: `translate3d(0, ${-drift * 0.5}px, 0)`, offset: 0.4 },
        { transform: 'translate3d(0, 0, 0)', offset: 0.5 },
        { transform: 'translate3d(0, 0, 0)', offset: 1 }
      ];
    case 'shake':
      return [
        { transform: 'translate3d(0, 0, 0) rotate(0deg)', offset: 0 },
        { transform: 'translate3d(-4px, 0, 0) rotate(-1deg)', offset: 0.04 },
        { transform: 'translate3d(4px, 0, 0) rotate(1deg)', offset: 0.08 },
        { transform: 'translate3d(-3px, 0, 0) rotate(-0.6deg)', offset: 0.12 },
        { transform: 'translate3d(2px, 0, 0) rotate(0.4deg)', offset: 0.16 },
        { transform: 'translate3d(0, 0, 0) rotate(0deg)', offset: 0.2 },
        { transform: 'translate3d(0, 0, 0) rotate(0deg)', offset: 1 }
      ];
    case 'flip':
      return [
        { transform: 'perspective(900px) rotateY(0deg)', offset: 0 },
        { transform: 'perspective(900px) rotateY(360deg)', offset: 0.35 },
        { transform: 'perspective(900px) rotateY(360deg)', offset: 1 }
      ];
    case 'spin':
      return [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }];
  }
}

/** Presets with built-in timing curves ignore the chosen easing. */
const OWN_EASING: Partial<Record<AnimPreset, string>> = {
  bounce: 'cubic-bezier(0.33, 0, 0.4, 1)',
  shake: 'ease-out'
};

export function hasAnimation(a: Anim | null | undefined): boolean {
  return !!a && a.preset !== 'none';
}

export function durationOf(a: Anim | null | undefined, phase: Phase): number {
  if (!a || a.preset === 'none') return 0;
  return a.duration_ms > 0 ? a.duration_ms : DEFAULT_MS[phase];
}

/** Keyframes and timing for one animation, or null for `none`. */
export function animSpec(a: Anim | null | undefined, phase: Phase, w = 400, h = 100): AnimSpec | null {
  if (!a || a.preset === 'none') return null;
  const frames =
    phase === 'enter' ? enterFrames(a.preset, w, h) : phase === 'exit' ? exitFrames(a.preset, w, h) : idleFrames(a.preset, w, h);
  if (!frames) return null;
  const duration = durationOf(a, phase);
  let easing = OWN_EASING[a.preset] ?? easingCss(a.easing, phase);
  if (phase === 'idle') {
    easing = a.preset === 'spin' ? 'linear' : a.easing === 'linear' ? 'linear' : 'ease-in-out';
  }
  const options: KeyframeAnimationOptions = {
    duration,
    delay: Math.max(0, a.delay_ms || 0),
    easing,
    fill: phase === 'idle' ? 'none' : 'both',
    iterations: phase === 'idle' ? Infinity : 1
  };
  return { keyframes: frames, options };
}

/** Runs an animation with the Web Animations API. Resolves when done or cancelled; never rejects. */
export function play(el: Element, spec: AnimSpec | null): { anim: globalThis.Animation | null; done: Promise<void> } {
  if (!spec || typeof (el as HTMLElement).animate !== 'function') return { anim: null, done: Promise.resolve() };
  const anim = (el as HTMLElement).animate(spec.keyframes, spec.options);
  const done = anim.finished.then(
    () => undefined,
    () => undefined
  );
  return { anim, done };
}
