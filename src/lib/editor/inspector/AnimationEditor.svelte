<script lang="ts">
  import type { AnimPreset } from '$lib/bindings/AnimPreset';
  import type { Animation } from '$lib/bindings/Animation';
  import type { Easing } from '$lib/bindings/Easing';
  import Button from '$lib/ui/Button.svelte';
  import { Play } from '@lucide/svelte';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';

  interface Props {
    anim: Animation;
    phase: 'enter' | 'exit' | 'idle';
    uid: string;
    set: (fn: (a: Animation) => void, key: string) => void;
    onpreview?: () => void;
  }

  let { anim, phase, uid, set, onpreview }: Props = $props();

  const PRESETS: Array<{ value: AnimPreset; label: string }> = [
    { value: 'none', label: 'None' },
    { value: 'fade', label: 'Fade' },
    { value: 'slide_up', label: 'Slide up' },
    { value: 'slide_down', label: 'Slide down' },
    { value: 'slide_left', label: 'Slide left' },
    { value: 'slide_right', label: 'Slide right' },
    { value: 'zoom', label: 'Zoom' },
    { value: 'pop', label: 'Pop' },
    { value: 'bounce', label: 'Bounce' },
    { value: 'flip', label: 'Flip' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'float', label: 'Float' },
    { value: 'shake', label: 'Shake' },
    { value: 'spin', label: 'Spin' }
  ];

  const EASINGS: Array<{ value: Easing; label: string }> = [
    { value: 'ease_out', label: 'Ease out' },
    { value: 'ease_in', label: 'Ease in' },
    { value: 'ease_in_out', label: 'Ease in and out' },
    { value: 'linear', label: 'Linear' },
    { value: 'spring', label: 'Spring' },
    { value: 'back', label: 'Overshoot' }
  ];

  const DEFAULT_MS = { enter: 500, exit: 400, idle: 2400 };
  const title = $derived({ enter: 'Enter', exit: 'Exit', idle: 'Idle loop' }[phase]);
</script>

<div class="anim">
  <div class="head">
    <label class="name" for="{uid}-{phase}">{title}</label>
    <select
      id="{uid}-{phase}"
      class="input"
      value={anim.preset}
      onchange={(e) => {
        const v = e.currentTarget.value as AnimPreset;
        set((a) => {
          a.preset = v;
          if (v !== 'none' && !a.duration_ms) a.duration_ms = DEFAULT_MS[phase];
        }, 'preset');
      }}
    >
      {#each PRESETS as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
    </select>
    {#if onpreview}
      <Button size="sm" variant="ghost" disabled={anim.preset === 'none'} onclick={onpreview} aria-label="Preview {title.toLowerCase()} animation">
        <Play size={13} />Preview
      </Button>
    {/if}
  </div>
  {#if anim.preset !== 'none'}
    <div class="grid">
      <Prop label={phase === 'idle' ? 'Loop length' : 'Duration'}>
        <NumberInput label="{title} duration" unit="ms" min={0} max={60000} step={50} value={anim.duration_ms} oninput={(v) => set((a) => (a.duration_ms = Math.round(v)), 'dur')} />
      </Prop>
      <Prop label="Delay">
        <NumberInput label="{title} delay" unit="ms" min={0} max={60000} step={50} value={anim.delay_ms} oninput={(v) => set((a) => (a.delay_ms = Math.round(v)), 'delay')} />
      </Prop>
      <Prop label="Easing" for="{uid}-{phase}-easing">
        <select
          id="{uid}-{phase}-easing"
          class="input"
          value={anim.easing}
          onchange={(e) => {
            const v = e.currentTarget.value as Easing;
            set((a) => (a.easing = v), 'easing');
          }}
        >
          {#each EASINGS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
        </select>
      </Prop>
    </div>
  {/if}
</div>

<style>
  .anim {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }
  .name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
