<script lang="ts">
  import type { SceneMode } from '$lib/bindings/SceneMode';
  import type { SceneRule } from '$lib/bindings/SceneRule';
  import type { SceneTransition } from '$lib/bindings/SceneTransition';
  import { defaultSceneRule } from '$lib/overlay/scenes';
  import Button from '$lib/ui/Button.svelte';
  import { Plus, X } from '@lucide/svelte';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';

  interface Props {
    rule: SceneRule | undefined;
    /** Scenes to pick from: OBS's list plus names typed before. */
    scenes: string[];
    obsConnected: boolean;
    /** The layer has its own enter and exit animations. */
    ownAnimations: boolean;
    uid: string;
    set: (fn: (r: SceneRule) => void, key: string) => void;
  }

  let { rule, scenes, obsConnected, ownAnimations, uid, set }: Props = $props();

  const r = $derived(rule ?? defaultSceneRule());
  const choices = $derived([...new Set([...scenes, ...r.scenes])]);
  let typed = $state('');

  const MODES: Array<{ value: SceneMode; label: string }> = [
    { value: 'all', label: 'Show in all scenes' },
    { value: 'only', label: 'Only in these scenes' },
    { value: 'hide', label: 'Hide in these scenes' }
  ];
  const TRANSITIONS: Array<{ value: SceneTransition; label: string }> = [
    { value: 'fade', label: 'Fade' },
    { value: 'slide', label: 'Slide' },
    { value: 'scale', label: 'Scale' },
    { value: 'none', label: 'None' }
  ];

  function toggle(name: string, on: boolean) {
    set((x) => {
      x.scenes = on ? [...new Set([...x.scenes, name])] : x.scenes.filter((s) => s !== name);
    }, 'scenes');
  }

  function addTyped() {
    const name = typed.trim();
    if (!name) return;
    toggle(name, true);
    typed = '';
  }
</script>

<div class="rule">
  <Prop label="Show" for="{uid}-scene-mode">
    <select
      id="{uid}-scene-mode"
      class="input"
      value={r.mode}
      onchange={(e) => {
        const v = e.currentTarget.value as SceneMode;
        set((x) => (x.mode = v), 'mode');
      }}
    >
      {#each MODES as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
    </select>
  </Prop>

  {#if r.mode !== 'all'}
    <div class="list" role="group" aria-label="Scenes">
      {#each choices as name (name)}
        {@const on = r.scenes.includes(name)}
        <label class="scene" class:on>
          <input type="checkbox" checked={on} onchange={(e) => toggle(name, e.currentTarget.checked)} />
          <span class="truncate">{name}</span>
          {#if on && !scenes.includes(name)}
            <button type="button" class="drop" aria-label="Remove {name}" title="Not in OBS's list" onclick={() => toggle(name, false)}><X size={12} /></button>
          {/if}
        </label>
      {:else}
        <p class="hint">No scenes yet. Type one below.</p>
      {/each}
    </div>
    <div class="add">
      <input
        class="input"
        aria-label="Scene name"
        placeholder="Scene name"
        bind:value={typed}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTyped();
          }
        }}
      />
      <Button size="sm" variant="ghost" disabled={!typed.trim()} onclick={addTyped}><Plus size={13} />Add</Button>
    </div>
    {#if !obsConnected}
      <p class="hint">OBS isn't connected. Type names exactly as they are in OBS.</p>
    {/if}
    {#if ownAnimations}
      <p class="hint">Comes and goes with the layer's enter and exit animations.</p>
    {:else}
      <div class="pair">
        <Prop label="Transition" for="{uid}-scene-tr">
          <select
            id="{uid}-scene-tr"
            class="input"
            value={r.transition}
            onchange={(e) => {
              const v = e.currentTarget.value as SceneTransition;
              set((x) => (x.transition = v), 'transition');
            }}
          >
            {#each TRANSITIONS as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
          </select>
        </Prop>
        {#if r.transition !== 'none'}
          <Prop label="Duration">
            <NumberInput label="Scene transition duration" unit="ms" min={0} max={10000} step={50} value={r.duration_ms} oninput={(v) => set((x) => (x.duration_ms = Math.round(v)), 'dur')} />
          </Prop>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .rule {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
  }
  .scene {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 6px;
    border-radius: 5px;
    font-size: 12.5px;
    cursor: pointer;
  }
  .scene:hover {
    background: var(--bg-3);
  }
  .scene.on {
    color: var(--text);
  }
  .scene span {
    flex: 1;
    min-width: 0;
  }
  .drop {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
  }
  .drop:hover {
    color: var(--danger);
  }
  .add {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }
  .pair {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
