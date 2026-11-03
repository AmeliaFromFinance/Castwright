<script lang="ts">
  import { moments, type MomentToast } from '$lib/state/moments.svelte';
  import { copyText, openExternal } from '$lib/util/os';
  import Button from '$lib/ui/Button.svelte';
  import { Copy, ExternalLink, Flag, LoaderCircle, Scissors, X } from '@lucide/svelte';

  interface Props {
    item: MomentToast;
  }
  let { item }: Props = $props();

  let note = $state('');
  let busy = $state(false);

  async function save() {
    if (item.kind !== 'marker' || busy) return;
    busy = true;
    await moments.saveNote(item.key, item.marker.id, note);
    busy = false;
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      moments.dismiss(item.key);
    }
  }
</script>

{#if item.kind === 'marker'}
  <div class="toast moment" role="status" aria-label="Marker added">
    <Flag size={16} />
    <div class="grow body">
      <div class="title">{item.marker.description} added</div>
      {#if item.marker.id}
        <form
          class="note"
          onsubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            bind:value={note}
            aria-label="Marker note"
            placeholder="Add a note (optional)"
            maxlength="200"
            onfocus={() => moments.hold(item.key)}
            oninput={() => moments.hold(item.key)}
            onkeydown={key}
          />
          <Button size="sm" type="submit" busy={busy} disabled={!note.trim()}>Save</Button>
        </form>
      {/if}
    </div>
    <button type="button" class="x" aria-label="Dismiss" onclick={() => moments.dismiss(item.key)}><X size={14} /></button>
  </div>
{:else}
  <div class="toast moment" role="status" aria-label={item.status === 'making' ? 'Making a clip' : 'Clip ready'}>
    {#if item.status === 'making'}<LoaderCircle size={16} class="spin" />{:else}<Scissors size={16} />{/if}
    <div class="grow body">
      {#if item.status === 'making'}
        <div class="title">Making a clip…</div>
        <div class="faint small">Twitch takes a few seconds.</div>
      {:else}
        <div class="title truncate">{item.status === 'ready' ? item.title || 'Clip ready' : 'Twitch is still making the clip'}</div>
        <div class="faint small truncate selectable">{item.url.replace(/^https:\/\//, '')}</div>
        {#if item.status === 'slow'}<div class="faint small">The link should work in a minute.</div>{/if}
        <div class="actions">
          <Button size="sm" onclick={() => copyText(item.url, 'Clip link copied')}><Copy size={13} />Copy link</Button>
          <Button size="sm" onclick={() => openExternal(item.url)}><ExternalLink size={13} />Open</Button>
        </div>
      {/if}
    </div>
    <button type="button" class="x" aria-label="Dismiss" onclick={() => moments.dismiss(item.key)}><X size={14} /></button>
  </div>
{/if}

<style>
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-pop);
    animation: in 0.2s var(--ease);
  }
  .toast > :global(svg:first-child) {
    flex: none;
    margin-top: 1px;
    color: var(--accent-text);
  }
  .body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .title {
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }
  .note {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }
  .note input {
    flex: 1;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .x {
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
  }
  .x:hover {
    color: var(--text);
  }
  .toast :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
