<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Copy, Trash2, TriangleAlert } from '@lucide/svelte';
  import { actionsEditor as ed } from './store.svelte';

  interface Props {
    action: Action;
    onduplicate: () => void;
    ondelete: () => void;
  }

  let { action, onduplicate, ondelete }: Props = $props();

  const nameIssue = $derived((ed.issues[action.id] ?? []).find((i) => i.key === 'name'));
  const warnings = $derived((ed.issues[action.id] ?? []).filter((i) => i.warn));
  const groups = $derived([...new Set((ed.actions ?? []).map((a) => a.group).filter((g) => g.trim()))].sort());
  const patch = (p: Partial<Action>) => ed.patchAction(action.id, p);
</script>

<div class="head">
  <div class="f name">
    <label for="act-name">Action name</label>
    <input
      id="act-name"
      class="input title"
      placeholder="Action name"
      aria-invalid={nameIssue ? 'true' : undefined}
      value={action.name}
      oninput={(e) => patch({ name: e.currentTarget.value })}
    />
    {#if nameIssue}<p class="error" role="alert">{nameIssue.message}</p>{/if}
  </div>
  <div class="f group">
    <label for="act-group">Group</label>
    <input
      id="act-group"
      class="input"
      list="act-groups"
      placeholder="General"
      value={action.group}
      onchange={(e) => patch({ group: e.currentTarget.value.trim() || 'General' })}
    />
    <datalist id="act-groups">
      {#each groups as g (g)}<option value={g}></option>{/each}
    </datalist>
  </div>
  <div class="f cd">
    <label for="act-cd" title="Shortest time between two runs. 0 means no limit.">Cooldown (seconds)</label>
    <input
      id="act-cd"
      class="input"
      type="number"
      min="0"
      title="Shortest time between two runs. 0 means no limit."
      value={action.cooldown_s}
      oninput={(e) => {
        const n = Math.round(Number(e.currentTarget.value));
        if (e.currentTarget.value.trim() !== '' && Number.isFinite(n)) patch({ cooldown_s: Math.max(0, Math.min(86_400, n)) });
      }}
    />
  </div>
  <div class="tools">
    {#if warnings.length}
      <span class="warns" role="status" title={[...new Set(warnings.map((w) => w.message))].join('\n')}>
        <TriangleAlert size={13} />{warnings.length} warning{warnings.length === 1 ? '' : 's'}
      </span>
      <span class="sep" aria-hidden="true"></span>
    {/if}
    <Switch label="Enabled" showLabel checked={action.enabled} onchange={(v) => patch({ enabled: v })} />
    <span class="sep" aria-hidden="true"></span>
    <IconButton label="Duplicate action" onclick={onduplicate}><Copy /></IconButton>
    <IconButton label="Delete action" tone="danger" onclick={ondelete}><Trash2 /></IconButton>
  </div>
</div>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .f > label {
    font-size: 11.5px;
    font-weight: 550;
    color: var(--text-faint);
  }
  .name {
    flex: 1 1 320px;
    max-width: 560px;
  }
  .group {
    flex: 0 1 220px;
  }
  .cd {
    flex: 0 0 130px;
  }
  .title {
    font-size: 14px;
    font-weight: 650;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding-top: 21px;
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
  .warns {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 550;
    white-space: nowrap;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
</style>
