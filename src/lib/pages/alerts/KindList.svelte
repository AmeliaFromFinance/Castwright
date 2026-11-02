<script lang="ts">
  import { api } from '$lib/api';
  import type { EventKind } from '$lib/bindings/EventKind';
  import { ALERT_KINDS, KIND_LABELS, kindTone } from '$lib/format';
  import { attempt } from '$lib/state/toast.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { FlaskConical, Plus } from '@lucide/svelte';
  import { newAlertType } from './alerts';
  import { alertsEditor as ed } from './store.svelte';

  function typeOf(kind: EventKind) {
    return ed.config?.types.find((t) => t.kind === kind);
  }

  function add(kind: EventKind) {
    if (!ed.config) return;
    const t = newAlertType(kind);
    ed.config.types.push(t);
    ed.kind = kind;
    ed.variationId = t.variations[0]!.id;
    ed.expanded[t.variations[0]!.id] = true;
    ed.changed();
  }

  function test(kind: EventKind) {
    void attempt(() => api.testEvent(kind));
  }
</script>

<nav class="kinds" aria-label="Alert types">
  <h2 class="eyebrow head">Alert types</h2>
  <ul>
    {#each ALERT_KINDS as kind (kind)}
      {@const t = typeOf(kind)}
      <li class:on={ed.kind === kind} class:missing={!t}>
        <button
          type="button"
          class="pick"
          aria-current={ed.kind === kind ? 'true' : undefined}
          onclick={() => {
            if (ed.kind === kind) return;
            ed.kind = kind;
            ed.variationId = null;
          }}
        >
          <span class="dot" style:background={kindTone(kind)} class:off={!t || !t.enabled}></span>
          <span class="text">
            <span class="name truncate">{KIND_LABELS[kind]}</span>
            <span class="meta faint">
              {#if !t}Not set up{:else if !t.enabled}Off{:else}{t.variations.length} variation{t.variations.length === 1 ? '' : 's'}{/if}
            </span>
          </span>
        </button>
        {#if t}
          <IconButton size="sm" label="Test {KIND_LABELS[kind]}" onclick={() => test(kind)}><FlaskConical /></IconButton>
          <Switch
            label="{KIND_LABELS[kind]} alerts on"
            checked={t.enabled}
            onchange={(v) => {
              t.enabled = v;
              ed.changed();
            }}
          />
        {:else}
          <IconButton size="sm" label="Add {KIND_LABELS[kind]} alert" onclick={() => add(kind)}><Plus /></IconButton>
        {/if}
      </li>
    {/each}
  </ul>
</nav>

<style>
  .kinds {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    height: 38px;
    flex: none;
    padding: 0 14px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 6px 8px;
    overflow: auto;
    min-height: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 4px;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--bg-2);
  }
  li.on {
    background: var(--bg-3);
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px 6px 10px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 550;
  }
  li.on .name {
    font-weight: 650;
  }
  .missing .name {
    color: var(--text-muted);
  }
  .meta {
    font-size: 11.5px;
  }
  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
  }
  .dot.off {
    opacity: 0.3;
  }
</style>
