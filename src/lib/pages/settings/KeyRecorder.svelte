<script lang="ts">
  import { api } from '$lib/api';
  import { comboParts, readKey } from './hotkeys';

  interface Props {
    value: string;
    /** Names the row for screen readers, e.g. "Skip alert". */
    label: string;
    mac?: boolean;
    disabled?: boolean;
    /** Return a message to keep recording (e.g. the combo is taken), or null to accept. */
    onrecord: (keys: string) => string | null;
  }
  let { value, label, mac = false, disabled = false, onrecord }: Props = $props();

  let recording = $state(false);
  let held = $state<string[]>([]);
  let hint = $state<string | null>(null);
  let button: HTMLButtonElement | undefined = $state();

  function start() {
    if (disabled || recording) return;
    recording = true;
    held = [];
    hint = null;
    // WebKit doesn't focus buttons on click, and keys go to the focused element.
    button?.focus();
    // Global hotkeys let go while recording, so they neither fire nor swallow the keys.
    api.hotkeysRecording(true).catch(() => {});
  }

  function stop() {
    if (!recording) return;
    recording = false;
    held = [];
    hint = null;
    api.hotkeysRecording(false).catch(() => {});
  }

  function finish(keys: string) {
    const err = onrecord(keys);
    if (err) {
      hint = err;
      held = [];
      return;
    }
    stop();
  }

  function keydown(e: KeyboardEvent) {
    if (!recording) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        start();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const r = readKey(e, mac);
    if (r.kind === 'cancel') stop();
    else if (r.kind === 'clear') finish('');
    else if (r.kind === 'waiting') {
      held = r.mods;
      hint = null;
    } else if (r.kind === 'invalid') hint = r.message;
    else finish(r.keys);
  }

  function keyup(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    const r = readKey(e, mac);
    if (r.kind === 'waiting') held = r.mods;
  }

  $effect(() => () => {
    if (recording) api.hotkeysRecording(false).catch(() => {});
  });

  const parts = $derived(recording ? comboParts(held.join('+'), mac) : comboParts(value, mac));
</script>

<div class="rec">
  <button
    bind:this={button}
    type="button"
    class="keys"
    class:recording
    class:empty={!value && !recording}
    {disabled}
    aria-label={recording ? `Recording a hotkey for ${label}. Press keys, Esc to cancel, Backspace to clear.` : `Hotkey for ${label}: ${value || 'not set'}. Press to change.`}
    onclick={() => (recording ? null : start())}
    onkeydown={keydown}
    onkeyup={keyup}
    onblur={stop}
  >
    {#if parts.length}
      {#each parts as p, i (i)}<kbd>{p}</kbd>{/each}
      {#if recording}<span class="dots">…</span>{/if}
    {:else if recording}
      <span class="prompt">Press keys…</span>
    {:else}
      <span class="unset">Not set</span>
    {/if}
  </button>
  {#if recording}
    <span class="help faint" aria-live="polite">{hint ?? 'Esc cancels · Backspace clears'}</span>
  {/if}
</div>

<style>
  .rec {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .keys {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 180px;
    height: var(--row-h);
    padding: 0 8px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-2);
    color: var(--text);
    font-size: 12.5px;
    cursor: pointer;
    transition:
      border-color 0.12s var(--ease),
      box-shadow 0.12s var(--ease);
  }
  .keys:hover:not(:disabled) {
    border-color: var(--text-faint);
  }
  .keys:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .keys.recording {
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 28%, transparent);
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 11.5px;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-3);
    white-space: nowrap;
  }
  .unset,
  .dots {
    color: var(--text-faint);
  }
  .prompt {
    color: var(--accent-text);
  }
  .help {
    font-size: 11.5px;
    max-width: 260px;
  }
</style>
