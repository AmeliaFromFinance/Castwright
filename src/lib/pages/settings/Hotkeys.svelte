<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { HotkeyBinding } from '$lib/bindings/HotkeyBinding';
  import type { HotkeyStatus } from '$lib/bindings/HotkeyStatus';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Info, Plus, Trash2, X } from '@lucide/svelte';
  import KeyRecorder from './KeyRecorder.svelte';
  import Row from './Row.svelte';
  import { ACTION_LABELS, findConflict, formatCombo, isAppShortcut, pickedId, rows, toSave } from './hotkeys';

  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

  let status = $state<HotkeyStatus | null>(null);
  let enabled = $state(app.settings?.hotkeys.enabled ?? true);
  let list = $state<HotkeyBinding[]>(rows(app.settings?.hotkeys.bindings ?? []));

  const actions = $derived(app.project?.actions ?? []);
  const sounds = $derived(app.project?.soundboard?.buttons ?? []);

  // Also ends a recording left open by a reload, so hotkeys listen again.
  onMount(() => {
    api
      .hotkeysRecording(false)
      .then((s) => (status = s))
      .catch(() => {});
  });

  function labelOf(b: HotkeyBinding): string {
    if (b.action.type === 'play_sound_button') {
      const id = b.action.sound_id;
      const sound = sounds.find((x) => x.id === id);
      return sound ? `Play "${sound.label}"` : 'Play sound button';
    }
    if (b.action.type !== 'run_action') return ACTION_LABELS[b.action.type];
    const id = b.action.action_id;
    const name = actions.find((a) => a.id === id)?.name;
    return name ? `Run "${name}"` : 'Run an action';
  }

  async function save() {
    const report = await attempt(() => api.saveHotkeys({ enabled, bindings: $state.snapshot(toSave(list)) }));
    if (!report) return;
    status = report.status;
    if (app.settings) app.settings.hotkeys = report.hotkeys;
  }

  function record(i: number, keys: string): string | null {
    const other = findConflict(list, keys, i);
    if (other >= 0) return `${formatCombo(keys, mac)} is already used for "${labelOf(list[other]!)}".`;
    if (isAppShortcut(keys)) return `Castwright uses ${formatCombo(keys, mac)} inside the app. Pick another.`;
    list[i]!.keys = keys;
    void save();
    return null;
  }

  function pick(i: number, id: string) {
    list[i]!.action = list[i]!.action.type === 'play_sound_button' ? { type: 'play_sound_button', sound_id: id } : { type: 'run_action', action_id: id };
    void save();
  }

  function remove(i: number) {
    const had = !!pickedId(list[i]!.action);
    list.splice(i, 1);
    if (had) void save();
  }

  const refused = (keys: string) => (keys ? status?.errors.find((e) => e.keys === keys)?.message : undefined);
</script>

{#if status?.note}
  <p class="note"><Info size={14} /> <span>{status.note}</span></p>
{/if}

<Row label="Use global hotkeys" hint="Off stops every hotkey below without losing them.">
  <Switch
    label="Use global hotkeys"
    checked={enabled}
    onchange={(on) => {
      enabled = on;
      void save();
    }}
  />
</Row>

<div class="list" role="list" aria-label="Hotkeys" class:off={!enabled}>
  {#each list as b, i}
    {@const run = b.action.type === 'run_action' ? b.action : null}
    {@const sound = b.action.type === 'play_sound_button' ? b.action : null}
    {@const error = refused(b.keys)}
    <div class="item" role="listitem">
      <div class="what">
        {#if run}
          <select class="input" aria-label="Action to run" value={run.action_id} onchange={(e) => pick(i, e.currentTarget.value)}>
            <option value="" disabled>Choose an action…</option>
            {#if run.action_id && !actions.some((a) => a.id === run.action_id)}
              <option value={run.action_id}>Deleted action</option>
            {/if}
            {#each actions as a (a.id)}
              <option value={a.id}>{a.name}</option>
            {/each}
          </select>
        {:else if sound}
          <select class="input" aria-label="Sound to play" value={sound.sound_id} onchange={(e) => pick(i, e.currentTarget.value)}>
            <option value="" disabled>Choose a sound…</option>
            {#if sound.sound_id && !sounds.some((x) => x.id === sound.sound_id)}
              <option value={sound.sound_id}>Deleted sound</option>
            {/if}
            {#each sounds as x (x.id)}
              <option value={x.id}>Play {x.emoji ? `${x.emoji} ` : ''}{x.label}</option>
            {/each}
          </select>
        {:else}
          <span class="name">{labelOf(b)}</span>
        {/if}
      </div>
      <KeyRecorder value={b.keys} label={labelOf(b)} {mac} onrecord={(k) => record(i, k)} />
      <div class="tools">
        {#if run || sound}
          <IconButton size="sm" tone="danger" label="Remove {labelOf(b)}" onclick={() => remove(i)}><Trash2 /></IconButton>
        {:else if b.keys}
          <IconButton size="sm" label="Clear hotkey for {labelOf(b)}" onclick={() => record(i, '')}><X /></IconButton>
        {/if}
      </div>
      {#if error}<p class="err" role="alert">{formatCombo(b.keys, mac)}: {error}</p>{/if}
    </div>
  {/each}
</div>

<div class="add">
  <Button size="sm" disabled={!actions.length} onclick={() => list.push({ action: { type: 'run_action', action_id: '' }, keys: '' })}>
    <Plus size={14} />Add action hotkey
  </Button>
  <Button size="sm" disabled={!sounds.length} onclick={() => list.push({ action: { type: 'play_sound_button', sound_id: '' }, keys: '' })}>
    <Plus size={14} />Add sound hotkey
  </Button>
</div>

<style>
  .add {
    display: flex;
    gap: 8px;
  }
  .note {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    max-width: 760px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.45;
  }
  .note :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .list {
    display: flex;
    flex-direction: column;
    max-width: 760px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .list.off .what,
  .list.off :global(.keys) {
    opacity: 0.55;
  }
  .item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 32px;
    align-items: start;
    gap: 6px 16px;
    padding: 8px 12px;
  }
  .item + .item {
    border-top: 1px solid var(--border);
  }
  .what {
    min-height: var(--row-h);
    display: flex;
    align-items: center;
    font-size: 13px;
  }
  .what select {
    max-width: 300px;
  }
  .tools {
    min-height: var(--row-h);
    display: flex;
    align-items: center;
  }
  .err {
    grid-column: 1 / -1;
    color: var(--danger);
    font-size: 12.5px;
  }
</style>
