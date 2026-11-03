<script lang="ts">
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { api } from '$lib/api';
  import type { QueueEntry } from '$lib/bindings/QueueEntry';
  import { defaultNameColor } from '$lib/overlay/color';
  import { toasts } from '$lib/state/toast.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { ChevronDown, ChevronUp, Eraser, GripVertical, ListOrdered, Shuffle, TriangleAlert, Users, X } from '@lucide/svelte';
  import { MAX_NOTE } from './play-forms';
  import { play } from './play.svelte';
  import QueueSettingsForm from './QueueSettingsForm.svelte';

  $effect(() => {
    untrack(() => void play.load());
  });

  const st = $derived(play.state);
  const q = $derived(st?.queue ?? null);
  const s = $derived(st?.queue_settings ?? null);
  const lanes = $derived(s?.sub_priority === 'lane');
  const byId = $derived(new Map((q?.waiting ?? []).map((e) => [e.viewer.id, e])));
  const ordered = $derived((st?.queue_order ?? []).map((id) => byId.get(id)).filter((e): e is QueueEntry => !!e));
  const positions = $derived(new Map((st?.queue_order ?? []).map((id, i) => [id, i + 1])));
  /** Lists people can be dragged within: one, or the sub lane and everyone else. */
  const groups = $derived(
    lanes && q
      ? [
          { key: 'subs', label: 'Sub lane', list: q.waiting.filter((e) => e.sub) },
          { key: 'all', label: 'Everyone else', list: q.waiting.filter((e) => !e.sub) }
        ]
      : [{ key: 'one', label: '', list: ordered }]
  );

  let busy = $state('');
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);
  let editing = $state<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    busy = key;
    try {
      await fn();
      if (done) toasts.success(done);
    } catch (e) {
      toasts.error(e);
    } finally {
      busy = '';
    }
  }

  const color = (e: QueueEntry) => e.viewer.color || defaultNameColor(e.viewer.login || e.viewer.name);

  /** Move `id` up or down one place within its list. */
  function nudge(list: QueueEntry[], id: string, by: -1 | 1) {
    const i = list.findIndex((e) => e.viewer.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    const before = by < 0 ? list[j]!.viewer.id : (list[j + 1]?.viewer.id ?? null);
    void run(`move-${id}`, () => api.queueMove(id, before));
  }

  function drop(list: QueueEntry[], targetId: string | null) {
    const id = dragging;
    dragging = null;
    over = null;
    if (!id || id === targetId) return;
    if (!list.some((e) => e.viewer.id === id)) return;
    void run(`move-${id}`, () => api.queueMove(id, targetId));
  }

  function saveNote(e: QueueEntry, note: string) {
    editing = null;
    if (note.trim() === e.note) return;
    void run(`note-${e.viewer.id}`, () => api.queueNote(e.viewer.id, note));
  }
</script>

{#snippet person(e: QueueEntry, pos: number | null, list: QueueEntry[] | null)}
  {#if pos !== null}<span class="pos mono">#{pos}</span>{/if}
  <span class="name" style="color:{color(e)}">{e.viewer.name}</span>
  {#if e.sub}<Badge tone="accent">Sub</Badge>{/if}
  {#if editing === e.viewer.id}
    <input
      class="input note-input"
      aria-label="Note for {e.viewer.name}"
      maxlength={MAX_NOTE}
      value={e.note}
      onblur={(ev) => saveNote(e, ev.currentTarget.value)}
      onkeydown={(ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur();
        if (ev.key === 'Escape') editing = null;
      }}
    />
  {:else}
    <button type="button" class="note" class:empty={!e.note} title="Edit note for {e.viewer.name}" onclick={() => (editing = e.viewer.id)}>{e.note || 'Add note'}</button>
  {/if}
  <span class="grow"></span>
  {#if list}
    <IconButton size="sm" label="Move {e.viewer.name} up" disabled={list[0] === e} onclick={() => nudge(list, e.viewer.id, -1)}><ChevronUp /></IconButton>
    <IconButton size="sm" label="Move {e.viewer.name} down" disabled={list[list.length - 1] === e} onclick={() => nudge(list, e.viewer.id, 1)}><ChevronDown /></IconButton>
  {/if}
  <IconButton size="sm" label="Remove {e.viewer.name}" onclick={() => run(`rm-${e.viewer.id}`, () => api.queueRemove(e.viewer.id))}><X /></IconButton>
{/snippet}

{#if play.error}
  <div class="center">
    <EmptyState title="The queue isn't available" body={play.error}>
      {#snippet icon()}<Users size={28} />{/snippet}
    </EmptyState>
  </div>
{:else if st && q && s}
  <div class="cols">
    <section class="col" aria-label="Viewer queue">
      <div class="top">
        <Switch label="Queue open" showLabel checked={q.open} onchange={(v) => run('open', () => api.queueSetOpen(v), v ? 'Queue open' : 'Queue closed')} />
        <span class="faint">{q.waiting.length} waiting{s.max_size ? ` of ${s.max_size}` : ''} · join with <code>{s.join_word}</code></span>
        <span class="grow"></span>
        <Button variant="primary" busy={busy === 'next'} disabled={!q.waiting.length} onclick={() => run('next', () => api.queueNext(0, false))}>
          <ListOrdered size={14} />Next{s.party_size > 1 ? ` ${s.party_size}` : ''}
        </Button>
        <Button busy={busy === 'random'} disabled={!q.waiting.length} onclick={() => run('random', () => api.queueNext(0, true))}><Shuffle size={14} />Random</Button>
        <Button variant="ghost" busy={busy === 'clear'} disabled={!q.waiting.length && !q.playing.length} onclick={() => run('clear', () => api.queueClear(), 'Queue cleared')}>
          <Eraser size={14} />Clear
        </Button>
      </div>

      {#if st.clash}
        <p class="warn" role="alert">
          <TriangleAlert size={14} />The giveaway uses {s.join_word} too. While it's open, {s.join_word} enters the giveaway, not the queue. Change one of the words.
        </p>
      {/if}

      <div class="group playing" role="group" aria-label="Playing now">
        <h3>Playing now</h3>
        {#if q.playing.length}
          <ul class="list">
            {#each q.playing as e (e.viewer.id)}
              <li class="row">{@render person(e, null, null)}</li>
            {/each}
          </ul>
        {:else}
          <p class="faint small">Press Next to pull in {s.party_size > 1 ? `${s.party_size} players` : 'the first in line'}.</p>
        {/if}
      </div>

      {#each groups as g (g.key)}
        <div class="group" role="group" aria-label={g.label || 'In line'}>
          <h3>{g.label || 'In line'}</h3>
          {#if g.list.length}
            <ul class="list" aria-label="{g.label || 'In line'} list">
              {#each g.list as e (e.viewer.id)}
                <li
                  class="row"
                  class:dragging={dragging === e.viewer.id}
                  class:over={over === e.viewer.id && dragging !== e.viewer.id}
                  draggable="true"
                  data-user-id={e.viewer.id}
                  animate:flip={{ duration: 180 }}
                  ondragstart={(ev) => {
                    dragging = e.viewer.id;
                    ev.dataTransfer?.setData('text/plain', e.viewer.id);
                    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
                  }}
                  ondragover={(ev) => {
                    if (!dragging) return;
                    ev.preventDefault();
                    over = e.viewer.id;
                  }}
                  ondragleave={() => {
                    if (over === e.viewer.id) over = null;
                  }}
                  ondrop={(ev) => {
                    ev.preventDefault();
                    drop(g.list, e.viewer.id);
                  }}
                  ondragend={() => {
                    dragging = null;
                    over = null;
                  }}
                >
                  <span class="grip" aria-hidden="true"><GripVertical size={14} /></span>
                  {@render person(e, positions.get(e.viewer.id) ?? null, g.list)}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="faint small">{q.open ? `Nobody yet. Viewers type ${s.join_word} to join.` : 'Open the queue to let viewers join.'}</p>
          {/if}
        </div>
      {/each}
    </section>
    <section class="col side" aria-label="Queue settings">
      <div class="head"><h2>Settings</h2></div>
      <QueueSettingsForm settings={s} />
    </section>
  </div>
{/if}

<style>
  .center {
    flex: 1;
    display: grid;
    place-items: center;
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  }
  .col {
    min-height: 0;
    overflow: auto;
    padding: 14px 18px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .side {
    border-left: 1px solid var(--border);
    gap: 0;
  }
  .head {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    min-height: 26px;
  }
  h2 {
    font-size: 15px;
  }
  h3 {
    font-size: 12px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    max-width: 720px;
  }
  .grow {
    flex: 1;
  }
  .warn {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 720px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    font-size: 12.5px;
  }
  .group {
    max-width: 720px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .playing .list {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 8px;
    font-size: 13px;
    background: var(--bg-1);
  }
  .row + .row {
    border-top: 1px solid var(--border);
  }
  .row[draggable='true'] {
    cursor: grab;
  }
  .row.dragging {
    opacity: 0.45;
  }
  .row.over {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .grip {
    display: grid;
    color: var(--text-faint);
  }
  .pos {
    min-width: 2.4em;
    color: var(--text-faint);
    font-size: 12px;
  }
  .name {
    font-weight: 700;
  }
  .note {
    padding: 2px 6px;
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 12.5px;
  }
  .note:hover {
    background: var(--bg-2);
  }
  .note.empty {
    color: var(--text-faint);
    font-style: italic;
  }
  .note-input {
    width: 180px;
  }
  .faint {
    color: var(--text-faint);
    font-size: 12.5px;
  }
  .small {
    font-size: 12px;
  }
</style>
