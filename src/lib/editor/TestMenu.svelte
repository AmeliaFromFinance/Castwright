<script lang="ts">
  import type { EventKind } from '$lib/bindings/EventKind';
  import { KIND_LABELS } from '$lib/format';
  import Button from '$lib/ui/Button.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { FlaskConical, MessageSquare, Play, SlidersHorizontal, Eraser, Zap } from '@lucide/svelte';
  import Popover from './ui/Popover.svelte';

  interface Props {
    kinds: EventKind[];
    sound: boolean;
    hasTestData: boolean;
    onalert: (kind: EventKind) => void;
    onevent: (kind: EventKind) => void;
    onchat: () => void;
    onvars: () => void;
    onclear: () => void;
    onsound: (on: boolean) => void;
  }

  let { kinds, sound, hasTestData, onalert, onevent, onchat, onvars, onclear, onsound }: Props = $props();

  let kind = $state<EventKind>('follow');
  $effect(() => {
    if (kinds.length && !kinds.includes(kind)) kind = kinds[0]!;
  });

  const EVENTS: EventKind[] = ['follow', 'sub', 'cheer', 'raid'];
</script>

<Popover role="dialog" label="Test the overlay" align="end" width={300}>
  {#snippet trigger(p)}
    <Button size="sm" {...p}><FlaskConical size={14} />Test</Button>
  {/snippet}
  {#snippet children(close)}
    <div class="test">
      <div class="block">
        <label class="eyebrow" for="test-alert-kind">Play an alert</label>
        <div class="row">
          <select id="test-alert-kind" class="input" bind:value={kind} disabled={!kinds.length}>
            {#each kinds as k (k)}<option value={k}>{KIND_LABELS[k]}</option>{/each}
            {#if !kinds.length}<option value="follow">No alerts are turned on</option>{/if}
          </select>
          <Button size="sm" variant="primary" disabled={!kinds.length} onclick={() => onalert(kind)}><Play size={13} />Play</Button>
        </div>
      </div>
      <div class="block">
        <span class="eyebrow">Send a test event</span>
        <div class="events">
          <button type="button" class="ev" onclick={onchat}><MessageSquare size={14} />Chat message</button>
          {#each EVENTS as e (e)}
            <button type="button" class="ev" onclick={() => onevent(e)}><Zap size={14} />{KIND_LABELS[e]}</button>
          {/each}
        </div>
        <p class="faint small">Only shown here, not in OBS.</p>
      </div>
      <div class="block">
        <button
          type="button"
          class="ev wide"
          onclick={() => {
            close();
            onvars();
          }}><SlidersHorizontal size={14} />Preview values…</button
        >
      </div>
      <div class="foot">
        <Switch label="Play sound" showLabel checked={sound} onchange={onsound} />
        <div class="grow"></div>
        <Button size="sm" variant="ghost" disabled={!hasTestData} onclick={onclear}><Eraser size={13} />Clear</Button>
      </div>
    </div>
  {/snippet}
</Popover>

<style>
  .test {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .row select {
    flex: 1;
    min-width: 0;
  }
  .events {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .ev {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
  }
  .ev:hover {
    background: var(--bg-3);
  }
  .ev :global(svg) {
    color: var(--text-muted);
    flex: none;
  }
  .wide {
    width: 100%;
  }
  .small {
    font-size: 11.5px;
  }
  .foot {
    display: flex;
    align-items: center;
    padding: 8px 4px 4px 8px;
  }
</style>
