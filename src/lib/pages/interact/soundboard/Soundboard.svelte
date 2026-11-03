<script lang="ts">
  import type { SoundButton } from '$lib/bindings/SoundButton';
  import { clock, useClock } from '$lib/overlay/clock.svelte';
  import { formatCombo, soundHotkey } from '$lib/pages/settings/hotkeys';
  import { cooldownLeft, moveButton, newButton, OUTPUT_LABELS, pageLabel, pages, playProgress, visibleButtons } from '$lib/soundboard/board';
  import { sounds } from '$lib/soundboard/player.svelte';
  import { currentBoard, saveBoard, saveSoundHotkey } from '$lib/soundboard/store.svelte';
  import { app } from '$lib/state/app.svelte';
  import { loadPref, savePref } from '$lib/state/persist';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { AudioLines, Headphones, Pencil, Plus, Radio, Search, Settings2, Square, Volume2, VolumeX } from '@lucide/svelte';
  import BoardSettings from './BoardSettings.svelte';
  import SoundDialog from './SoundDialog.svelte';

  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
  const board = $derived(currentBoard());
  const status = $derived(sounds.status);
  const muted = $derived(status?.muted ?? board.muted);

  let page = $state(loadPref<string>('soundboard.page', ''));
  $effect(() => savePref('soundboard.page', page));
  $effect(() => {
    if (!pages(board).includes(page)) page = '';
  });
  let query = $state('');
  const shown = $derived(visibleButtons(board, page, query));
  const anyPlaying = $derived(Object.keys(sounds.playing).length > 0);
  const now = $derived(clock.now);
  const cooling = $derived(!!status && (status.global_until > now || Object.values(status.cooldowns).some((t) => t > now)));
  $effect(() => {
    if (anyPlaying || cooling) return useClock();
  });
  const needsOverlay = $derived(!!status && status.stream_pages === 0 && board.buttons.some((b) => b.output !== 'local'));

  let editing = $state<SoundButton>(newButton());
  let isNew = $state(true);
  let dialogOpen = $state(false);
  let settingsOpen = $state(false);

  function add() {
    editing = newButton({ group: page });
    isNew = true;
    dialogOpen = true;
  }

  function edit(b: SoundButton) {
    editing = b;
    isNew = false;
    dialogOpen = true;
  }

  async function saveSound(b: SoundButton) {
    const buttons = isNew ? [...board.buttons, b] : board.buttons.map((x) => (x.id === b.id ? b : x));
    if (await saveBoard({ ...board, buttons })) dialogOpen = false;
  }

  async function removeSound(b: SoundButton) {
    if (!(await saveBoard({ ...board, buttons: board.buttons.filter((x) => x.id !== b.id) }))) return;
    dialogOpen = false;
    if (soundHotkey(app.settings?.hotkeys.bindings ?? [], b.id)) await saveSoundHotkey(b.id, '');
  }

  // Drag a button onto another to put it there. Alt + arrow keys do the same.
  let dragId = $state<string | null>(null);
  let overId = $state<string | null>(null);

  function drop(targetId: string) {
    const id = dragId;
    dragId = overId = null;
    if (id && id !== targetId) void saveBoard({ ...board, buttons: moveButton(board.buttons, id, targetId) });
  }

  function nudge(e: KeyboardEvent, b: SoundButton) {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const i = shown.findIndex((x) => x.id === b.id);
    const target = shown[i + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (target) void saveBoard({ ...board, buttons: moveButton(board.buttons, b.id, target.id) });
  }

  const file = (src: string) => src.split('/').pop() ?? '';
</script>

<section class="sb" aria-label="Soundboard">
  <header class="head">
    <div class="titles">
      <h2>Soundboard</h2>
      <p class="muted lead">Click to play. Click again to stop.</p>
    </div>
    <label class="search">
      <Search size={14} />
      <input class="input" type="search" placeholder="Search sounds" aria-label="Search sounds" bind:value={query} />
    </label>
    <div class="grow"></div>
    <div class="mute">
      <Button size="sm" variant={muted ? 'danger' : 'secondary'} pressed={muted} onclick={() => sounds.setMuted(!muted)}>
        {#if muted}<VolumeX size={14} />Soundboard muted{:else}<Volume2 size={14} />Mute soundboard{/if}
      </Button>
      <span class="faint">Only the soundboard. Alerts have their own mute.</span>
    </div>
    <Button size="sm" disabled={!anyPlaying} onclick={() => sounds.stopAll()}><Square size={13} />Stop all</Button>
    <IconButton label="Soundboard settings" onclick={() => (settingsOpen = true)}><Settings2 /></IconButton>
    <Button size="sm" variant="primary" onclick={add}><Plus size={14} />Add sound</Button>
  </header>

  {#if muted}
    <p class="banner warn" role="status">The soundboard is muted, so nothing plays: not on stream, not here. Alerts still play.</p>
  {:else if needsOverlay}
    <p class="banner" role="status">On stream sounds play through an overlay with an Alerts layer. None is open in OBS right now, so viewers won't hear them.</p>
  {/if}

  {#if board.groups.length && !query.trim()}
    <div class="tabs" role="tablist" aria-label="Sound pages">
      {#each pages(board) as g (g)}
        <button type="button" role="tab" class="tab" aria-selected={page === g} onclick={() => (page = g)}>
          {pageLabel(g)}
          <span class="count">{visibleButtons(board, g).length}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="body">
    {#if !board.buttons.length}
      <EmptyState title="No sounds yet" body="Add a sound file, then play it on stream, just for you, or both.">
        {#snippet icon()}<AudioLines size={28} />{/snippet}
        <Button variant="primary" onclick={add}><Plus size={14} />Add sound</Button>
      </EmptyState>
    {:else if !shown.length}
      <p class="none muted">{query.trim() ? `No sounds match "${query.trim()}".` : 'No sounds on this page yet.'}</p>
    {:else}
      <ul class="grid" aria-label="Sounds">
        {#each shown as b (b.id)}
          {@const playing = sounds.playing[b.id]}
          {@const left = cooldownLeft(status, b.id, now)}
          {@const progress = playing ? playProgress(playing.startedAt, playing.durationMs, now) : null}
          {@const keys = soundHotkey(app.settings?.hotkeys.bindings ?? [], b.id)}
          <li
            class="cell"
            class:over={overId === b.id && dragId !== b.id}
            class:dragging={dragId === b.id}
            data-sound={b.label}
            draggable="true"
            ondragstart={(e) => {
              dragId = b.id;
              e.dataTransfer?.setData('text/plain', b.id);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            ondragend={() => (dragId = overId = null)}
            ondragover={(e) => {
              if (!dragId) return;
              e.preventDefault();
              overId = b.id;
            }}
            ondrop={(e) => {
              e.preventDefault();
              drop(b.id);
            }}
          >
            <button
              type="button"
              class="pad"
              class:playing={!!playing}
              class:cooling={left > 0 && !playing}
              class:empty={!b.src}
              style:--pad={b.color || 'var(--accent)'}
              aria-label={playing ? `Stop ${b.label}` : `Play ${b.label}`}
              aria-pressed={!!playing}
              title={b.src ? `${file(b.src)} · ${OUTPUT_LABELS[b.output]} · Alt + arrows to move` : 'No sound file yet'}
              onclick={() => sounds.toggle(b.id)}
              onkeydown={(e) => nudge(e, b)}
            >
              <span class="emoji" aria-hidden="true">{b.emoji || '🔊'}</span>
              <span class="label">{b.label}</span>
              <span class="meta">
                {#if b.output === 'local'}<Headphones size={12} />{:else if b.output === 'both'}<Radio size={12} /><Headphones size={12} />{:else}<Radio size={12} />{/if}
                <span>{OUTPUT_LABELS[b.output]}</span>
                {#if keys}<span class="keys mono">{formatCombo(keys, mac)}</span>{/if}
              </span>
              {#if playing}
                <span class="state playing-tag"><Square size={10} />Playing</span>
                <span class="track" aria-hidden="true">
                  <span class="fill" class:unknown={progress === null} style:width={progress === null ? '100%' : `${Math.round(progress * 100)}%`}></span>
                </span>
              {:else if left > 0}
                <span class="state cool" aria-label="Cooldown {left} seconds">{left} s</span>
              {:else if !b.src}
                <span class="state">No file</span>
              {/if}
            </button>
            <IconButton size="sm" class="edit" label="Edit {b.label}" onclick={() => edit(b)}><Pencil /></IconButton>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<SoundDialog bind:open={dialogOpen} sound={editing} {isNew} onsave={saveSound} ondelete={removeSound} />
<BoardSettings
  bind:open={settingsOpen}
  {board}
  onsave={async (b) => {
    if (await saveBoard(b)) settingsOpen = false;
  }}
/>

<style>
  .sb {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 12px;
    padding: 14px 18px 10px;
  }
  h2 {
    font-size: 15px;
  }
  .lead {
    font-size: 12.5px;
    margin-top: 2px;
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    color: var(--text-faint);
  }
  .search :global(svg) {
    position: absolute;
    left: 9px;
    pointer-events: none;
  }
  .search input {
    width: 220px;
    padding-left: 28px;
  }
  .mute {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .mute span {
    font-size: 11px;
  }
  .banner {
    margin: 0 18px 8px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
    font-size: 12.5px;
  }
  .banner.warn {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    border-color: color-mix(in srgb, var(--warn) 35%, transparent);
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 18px;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tab[aria-selected='true'] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .count {
    font-size: 11px;
    color: var(--text-faint);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px 18px 24px;
  }
  .none {
    font-size: 13px;
  }
  .grid {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .cell {
    position: relative;
    border-radius: var(--radius-lg);
  }
  .cell.dragging {
    opacity: 0.4;
  }
  .cell.over .pad {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }
  .pad {
    position: relative;
    width: 100%;
    min-height: 112px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px 12px 14px;
    border: 1px solid color-mix(in srgb, var(--pad) 40%, var(--border));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--pad) 14%, var(--bg-1));
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      transform 0.08s var(--ease),
      background 0.15s var(--ease);
  }
  .pad:hover {
    background: color-mix(in srgb, var(--pad) 22%, var(--bg-1));
  }
  .pad:active {
    transform: scale(0.98);
  }
  .pad.playing {
    background: color-mix(in srgb, var(--pad) 32%, var(--bg-1));
    border-color: var(--pad);
  }
  .pad.cooling,
  .pad.empty {
    opacity: 0.6;
  }
  .emoji {
    font-size: 26px;
    line-height: 1;
  }
  .label {
    font-size: 13.5px;
    font-weight: 650;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .keys {
    margin-left: 4px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--bg-3);
  }
  .state {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 650;
    background: var(--bg-3);
    color: var(--text-muted);
  }
  .playing-tag {
    background: color-mix(in srgb, var(--pad) 35%, var(--bg-1));
    box-shadow: inset 0 0 0 1px var(--pad);
    color: var(--text);
  }
  .cool {
    font-variant-numeric: tabular-nums;
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
    background: color-mix(in srgb, var(--pad) 25%, transparent);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--pad);
    transition: width 0.9s linear;
  }
  .fill.unknown {
    animation: sb-pulse 1.2s ease-in-out infinite;
  }
  @keyframes sb-pulse {
    50% {
      opacity: 0.35;
    }
  }
  .cell :global(.edit) {
    position: absolute;
    right: 6px;
    bottom: 10px;
    opacity: 0;
  }
  .cell:hover :global(.edit),
  .cell :global(.edit:focus-visible) {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .fill,
    .pad {
      transition: none;
    }
    .fill.unknown {
      animation: none;
    }
  }
</style>
